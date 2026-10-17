// Real PPTX conversion + MP4 extraction: run in an OS with LibreOffice, poppler and ffmpeg.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(join(tmpdir(),"alfa-real-pptx-"));
const bundles = join(temp,"bundles");
const source = join(temp,"actual-lecture.pptx");
const video = join(temp,"sample.mp4");
const port = 4240;
let child, browser;
function command(exe,args) {
  return new Promise((resolve,reject)=>{
    const proc=spawn(exe,args,{stdio:["ignore","pipe","pipe"]});
    let output="";
    proc.stdout.on("data",(x)=>output+=x.toString());
    proc.stderr.on("data",(x)=>output+=x.toString());
    proc.once("error",reject);
    proc.once("close",(code)=>code===0?resolve(output):reject(new Error(exe+" failed: "+output.slice(-1200))));
  });
}
try {
  await command("ffmpeg",["-v","error","-y","-f","lavfi","-i","color=c=blue:s=320x240:d=1",
    "-f","lavfi","-i","sine=frequency=440:duration=1","-shortest",
    "-c:v","libx264","-pix_fmt","yuv420p","-c:a","aac",video]);
  await command("python3",[join(root,"tests","create-import-fixture.py"),source,video]);
  child=spawn(process.execPath,[join(root,"server","server.mjs")],{
    env:{...process.env,PORT:String(port), ADMIN_TOKEN:"real-pptx-test-admin",
      BUNDLES_ROOT:bundles,VOTES_FILE:join(temp,"votes.json"),SCENES_FILE:join(temp,"scenes.json")},
    stdio:["ignore","pipe","pipe"]
  });
  await new Promise((resolve,reject)=>{
    child.stdout.once("data",resolve);child.once("error",reject);
    setTimeout(()=>reject(new Error("server startup timed out")),10000).unref();
  });
  const url="http://localhost:"+port;
  const raw=readFileSync(source);
  const endpoint=url+"/api/lectures/import";
  const wrong=await fetch(endpoint,{
    method:"POST",headers:{"X-Admin-Token":"invalid","X-Alfa-Filename":"lecture.pptx"},
    body:raw
  });
  assert.equal(wrong.status,401);
  const result=await fetch(endpoint,{
    method:"POST",
    headers:{"X-Admin-Token":"real-pptx-test-admin",
      "X-Alfa-Filename":encodeURIComponent("محاضرة تجريبية.pptx"),
      "Content-Type":"application/vnd.openxmlformats-officedocument.presentationml.presentation"},
    body:raw
  });
  const uploaded=await result.json();
  assert.equal(result.status,201,JSON.stringify(uploaded));
  assert.equal(uploaded.slideCount,2);
  assert.match(uploaded.id,/^[a-f0-9]{12}$/);
  const manifest=JSON.parse(readFileSync(join(bundles,uploaded.id,"manifest.json"),"utf8"));
  assert.equal(manifest.source,"محاضرة تجريبية.pptx");
  assert.match(manifest.slides[0].text,/الألعاب التعليمية/);
  assert.equal(manifest.slides[1].videos.length,1);
  const clip=manifest.slides[1].videos[0];
  const range=await fetch(url+"/bundles/"+uploaded.id+"/"+clip.src,{
    headers:{"Range":"bytes=0-50"}
  });
  assert.equal(range.status,206);
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH||chromium.executablePath(),
    args:["--no-sandbox","--autoplay-policy=no-user-gesture-required"]});
  const page=await browser.newPage();
  await page.goto(url+"/?bundle="+uploaded.id);
  await page.locator("#next").click();
  await page.locator("video.clip").waitFor();
  const playable=await page.locator("video.clip").evaluate((el)=>new Promise((resolve)=>{
    if(el.readyState>=2)return resolve(el.videoWidth>0);
    el.addEventListener("loadeddata",()=>resolve(el.videoWidth>0),{once:true});
    el.addEventListener("error",()=>resolve(false),{once:true});
    setTimeout(()=>resolve(false),10000);
  }));
  assert.equal(playable,true,"Video must decode in Chromium, not merely exist on disk");
  await page.close();
  console.log("real PPTX upload, media extraction, video HTTP ranges and Chromium decode: passed");
} finally {
  await browser?.close();
  child?.kill();
  rmSync(temp,{recursive:true,force:true});
}
