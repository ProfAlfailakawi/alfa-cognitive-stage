import assert from "node:assert/strict";
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const pptx = process.env.ALFA_TEST_PPTX || "/tmp/alfa-ci-lecture.pptx";
const port=4288, base="http://127.0.0.1:"+port;
const token="integration-test-admin-abc123456789";
if (!existsSync(pptx)) throw Error("Missing synthetic PPTX fixture");
let browser;
const child=spawn(process.execPath,[join(root,"server/server.mjs")],{
 env:{...process.env,PORT:String(port),ADMIN_TOKEN:token},
 stdio:["ignore","pipe","pipe"]
});
let logs="";
child.stderr.on("data",(b)=>{logs+=b.toString();});
child.stdout.on("data",(b)=>{logs+=b.toString();});
const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));
try {
  let ready=false;
  for(let i=0;i<60;i++){
    try { const r=await fetch(base+"/api/admin/check",{headers:{"X-Admin-Token":token}});if(r.ok){ready=true;break;} }
    catch {}
    await sleep(100);
  }
  assert.equal(ready,true,"server should start");
  const untrusted=await fetch(base+"/api/lectures/import",{method:"POST"});
  assert.equal(untrusted.status,401,"upload must be admin-only");
  const prereq=await fetch(base+"/api/lectures/prerequisites",{headers:{"X-Admin-Token":token}});
  assert.equal(prereq.status,200);
  const health=await prereq.json();
  assert.equal(health.ready,true,JSON.stringify(health));
  const file=readFileSync(pptx);
  let id;
  for(let round=0;round<2;round++){
    const result=await fetch(base+"/api/lectures/import",{
      method:"POST",headers:{
        "X-Admin-Token":token,
        "X-Lecture-Filename":encodeURIComponent("اختبار_محاضرة.pptx"),
        "Content-Type":"application/vnd.openxmlformats-officedocument.presentationml.presentation"
      },body:file
    });
    const body=await result.json();
    assert.equal(result.status,201,JSON.stringify(body));
    assert.equal(body.lecture.slides,2);
    if (id) assert.equal(body.lecture.id,id,"identical upload should use cached conversion");
    id=body.lecture.id;
  }
  const manifest=await (await fetch(base+"/bundles/"+id+"/manifest.json")).json();
  assert.equal(manifest.slides.length,2);
  assert.equal(manifest.slides[1].videos.length,1,"embedded MP4 must be extracted");
  const videoPath=manifest.slides[1].videos[0].src;
  const range=await fetch(base+"/bundles/"+id+"/"+videoPath, {
    headers:{"Range":"bytes=0-50"}
  });
  assert.equal(range.status,206,"video must be seekable through HTTP Range");
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH||chromium.executablePath(),
    args:["--no-sandbox","--autoplay-policy=no-user-gesture-required"]});
  const page=await browser.newPage();
  await page.goto(base+"/?bundle="+id+"#presenter");
  await page.locator("#next").click();
  await page.locator("video.clip").waitFor();
  // A metadata-only video remains readyState=1 until playback begins.
  // Explicitly play before waiting for decoded frames; this tests media, not preload policy.
  const playback=await page.locator("video.clip").evaluate(async (v)=>{
    v.muted=true;
    try {
      await Promise.race([
        v.play(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("video.play timed out")), 10000))
      ]);
      if (v.readyState < 2) await Promise.race([
        new Promise((resolve)=>v.addEventListener("loadeddata",resolve,{once:true})),
        new Promise((resolve)=>v.addEventListener("error",resolve,{once:true})),
        new Promise((resolve)=>setTimeout(resolve,10000))
      ]);
    } catch (error) {
      return { decoded:false, reason:error.message, src:v.currentSrc, readyState:v.readyState,
        videoWidth:v.videoWidth, mediaError:v.error?.code || null };
    }
    return {decoded:v.readyState>=2 && v.videoWidth>0,
      src:v.currentSrc,readyState:v.readyState,videoWidth:v.videoWidth,
      mediaError:v.error?.code || null};
  });
  assert.equal(playback.decoded,true,"real embedded video must decode in Chromium: "+JSON.stringify(playback));
  await page.close();
  assert.ok(manifest.slides[0].text.includes("الألعاب"));
  assert.ok(manifest.slides[1].notes.includes("2"));
  const image=await fetch(base+"/bundles/"+id+"/slides/001.png");
  assert.equal(image.status,200);
  assert.ok(Number(image.headers.get("content-length"))>1000);
  const current=await (await fetch(base+"/bundles/current.json")).json();
  assert.equal(current.id,id);
  console.log("PASS real PPTX import, embedded MP4 extraction, range seeking and Chromium decode");
} catch(error) {
  console.error(logs);
  throw error;
} finally {await browser?.close();child.kill();}
