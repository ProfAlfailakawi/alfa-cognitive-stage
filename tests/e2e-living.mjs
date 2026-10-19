// Real Chromium integration: the five tools share one lecturer drawer and an audience-safe projector.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = 4341, base = "http://localhost:" + port;
const admin = "alfa-living-test-admin-0123456789";
const bundle = JSON.parse(readFileSync(join(root, "bundles/current.json"), "utf8")).id;
const failures = [];
const check = (name, condition, detail = "") => {
  console.log((condition ? "PASS " : "FAIL ") + name + (detail ? " — " + detail : ""));
  if (!condition) failures.push(name);
};
const shots = process.env.LIVING_SHOTS || "";
if (shots) mkdirSync(shots, { recursive: true });
const server = spawn(process.execPath, [join(root, "server/server.mjs")], {
  env: { ...process.env, PORT: String(port), ADMIN_TOKEN: admin,
    VOTES_FILE: "/tmp/alfa-living-e2e-votes.json",
    SCENES_FILE: "/tmp/alfa-living-e2e-scenes.json",
    LIBRARY_FILE: "/tmp/alfa-living-e2e-library.json",
    QUESTION_BANK_FILE: "/tmp/alfa-living-e2e-question-bank.json" },
  stdio: ["ignore","pipe","pipe"],
});
const serverErrors=[];
server.stderr.on("data",(data)=>serverErrors.push(String(data)));
await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error("server startup timed out: "+serverErrors.join(" "))),10000);
  server.once("exit",(code)=>{clearTimeout(timer);reject(Error("server exited "+code));});
  server.stdout.once("data",()=>{clearTimeout(timer);resolve();});
});
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args:["--no-sandbox","--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
const presenter = await context.newPage(), audience = await context.newPage();
presenter.on("pageerror",(e)=>failures.push("presenter pageerror: "+e.message));
audience.on("pageerror",(e)=>failures.push("audience pageerror: "+e.message));
const selected = (i) => presenter.locator("#cognitive-drawer > details").nth(i);
const wait = async (ms=320) => presenter.waitForTimeout(ms);
const open = async (i) => {
  const panel=selected(i);
  await panel.evaluate((element)=>{element.open=true;});
  return panel;
};
try {
  await presenter.goto(base+"/?dev=1");
  await presenter.waitForSelector("#cognitive-drawer");
  await audience.goto(base+"/?bundle="+bundle+"#audience");
  await audience.waitForSelector("#slide-img");
  await presenter.locator("#cognitive-drawer > summary").click();

  const living = await open(0);
  const author = living.locator("textarea").first();
  await author.fill("الألعاب التعليمية تعزز الدافعية");
  await living.locator("select").first().selectOption("topic");
  await living.getByRole("button",{name:"أضف للمشهد"}).click();
  await audience.locator(".cognitive-card-stage").waitFor({timeout:5000});
  check("approved living graph projects to audience",
    (await audience.locator(".cognitive-card-stage").innerText()).includes("الألعاب التعليمية"));
  check("projector does not contain raw provenance",await audience.locator("[data-source],.cognitive-editor").count() === 0);
  const slideBefore = await presenter.locator("#slide-img").getAttribute("src");
  await author.fill("الدافعية");
  await living.locator("select").first().selectOption("concept");
  await living.getByRole("button",{name:"أضف للمشهد"}).click();
  await audience.waitForFunction(()=>document.querySelectorAll(".cognitive-node").length===2);
  check("new concept is incrementally shown",await audience.locator(".cognitive-node").count()===2);
  await audience.waitForSelector(".cognitive-links .cognitive-link-path", {state:"attached"});
  check("actual approved conceptual relation is drawn",
    await audience.locator(".cognitive-links .cognitive-link-path").count()===1);
  check("original PowerPoint slide image is unchanged",await presenter.locator("#slide-img").getAttribute("src") === slideBefore);
  await wait(480); // capture the finished fade, not a mid-transition frame
  if (shots) await audience.locator("#stage").screenshot({path:join(shots,"living-1366.png")});
  await presenter.locator("#home").click();
  await audience.waitForFunction(()=>!document.querySelector(".cognitive-projection"));
  check("emergency return restores original image",await presenter.locator("#slide-img").getAttribute("src")===slideBefore);
  check("emergency return clears audience",await audience.locator(".cognitive-projection").count()===0);

  // Real presenter X-Ray controls operate on pixel-grounded synthetic fixture bounds.
  const xray = await open(1);
  await xray.locator(".cognitive-shape-choice input").first().check();
  await xray.getByRole("button",{name:"ركّز على الاختيار"}).click();
  await audience.waitForSelector(".cognitive-xray .cognitive-focus-outline");
  const focus = await audience.locator(".cognitive-focus-outline").first()
    .evaluate((el)=>({left:Number(el.getAttribute("x"))/10,width:Number(el.getAttribute("width"))/10}));
  check("X-Ray focuses original slide coordinates without moving image",
    Math.abs(focus.left - 12)<.1 && Math.abs(focus.width - 40)<.1 &&
      await presenter.locator("#slide-img").getAttribute("src")===slideBefore);
  await xray.locator(".cognitive-shape-choice input").nth(1).check();
  await xray.getByRole("button",{name:"ركّز على الاختيار"}).click();
  await audience.waitForFunction(()=>document.querySelectorAll(".cognitive-focus-outline").length===2);
  check("X-Ray supports two original elements",await audience.locator(".cognitive-focus-outline").count()===2);
  check("X-Ray uses a single even-odd dimming surface for both clear regions",
    await audience.locator(".cognitive-focus-mask path[fill-rule='evenodd']").count()===1);
  await wait(480);
  if(shots) await audience.locator("#stage").screenshot({path:join(shots,"xray-16x9.png")});
  await presenter.locator("#home").click();
  await audience.waitForFunction(()=>!document.querySelector(".cognitive-xray"));
  await xray.getByRole("button",{name:"تحديد بالنقر على معاينة الشريحة"}).click();
  const stageSize=await presenter.locator("#stage").boundingBox();
  await presenter.locator("#stage").click({position:{x:stageSize.width*.2,y:stageSize.height*.43}});
  await audience.waitForSelector(".cognitive-xray .cognitive-focus-outline");
  check("X-Ray preview click selects a safely mapped shape",await audience.locator(".cognitive-focus-outline").count()===1);
  await presenter.locator("#home").click();

  // Recover approved knowledge after a presenter refresh; no transcript is exported.
  await presenter.reload();
  await presenter.waitForSelector("#cognitive-drawer");
  await presenter.locator("#cognitive-drawer > summary").click();
  const newLiving = await open(0);
  check("graph memory persisted after reload",
    (await newLiving.locator(".meta").filter({hasText:"عناصر معتمدة"}).first().innerText()).includes("2"));
  await newLiving.getByRole("button",{name:"التالي"}).click();
  check("graph restoration shows approved exact text",
    (await presenter.locator(".cognitive-card-stage").innerText()).includes("الألعاب التعليمية"));
  await presenter.locator("#home").click();

  // A real drafted scenario is invisible until its author explicitly reveals a selected result.
  const whatif = await open(4);
  await whatif.locator('input[type="text"]').first().fill("قرار النشاط");
  await whatif.locator("textarea").first().fill("أي أسلوب مناسب؟");
  const choices=whatif.locator(".cognitive-choice-editor");
  await choices.nth(0).locator("input").first().fill("نشاط تعاوني");
  await choices.nth(0).locator("textarea").nth(0).fill("نقاش مجموعات");
  await choices.nth(0).locator("textarea").nth(1).fill("سيناريو كتبه المحاضر");
  await choices.nth(1).locator("input").first().fill("نشاط فردي");
  await choices.nth(1).locator("textarea").nth(0).fill("مهمة فردية");
  await choices.nth(1).locator("textarea").nth(1).fill("سيناريو كتبه المحاضر");
  check("scenario uses accessible separate fields", await choices.count()===2);
  await whatif.getByRole("button",{name:"احفظ السيناريو"}).click();
  await whatif.getByRole("button",{name:"اعرض السؤال"}).click();
  await audience.waitForFunction(()=>document.querySelector(".cognitive-card-stage")?.textContent?.includes("أي أسلوب مناسب"));
  check("unrevealed scenario hides branch results",
    !(await audience.locator(".cognitive-card-stage").innerText()).includes("نقاش مجموعات"));
  await wait(480);
  if (shots) await audience.locator("#stage").screenshot({path:join(shots,"whatif-hidden.png")});
  await whatif.getByRole("button",{name:"اكشف النتيجة المختارة"}).click();
  await audience.waitForFunction(()=>document.querySelector(".cognitive-card-stage")?.textContent?.includes("نقاش مجموعات"));
  check("explicit reveal exposes only selected predefined result",
    (await audience.locator(".cognitive-card-stage").innerText()).includes("نقاش مجموعات"));
  await wait(480);
  if (shots) await audience.locator("#stage").screenshot({path:join(shots,"whatif-revealed.png")});
  // Arbitrary deterministic math is explicit, bounded and never silently projected.
  await whatif.locator("details").last().evaluate((el) => { el.open = true; });
  await whatif.locator('input[placeholder="120*(1+15%)"]').fill("120*(1+15%)");
  await whatif.getByRole("button",{name:"قيّم الصيغة"}).click();
  check("safe formula renders expected deterministic result to lecturer only",
    (await presenter.locator("#cognitive-drawer > .meta").innerText()).includes("138") &&
    !(await audience.locator(".cognitive-card-stage").innerText()).includes("138"));

  // Late-join audience receives only approved projection via existing snapshot protocol.
  const late=await context.newPage();
  late.on("pageerror",(e)=>failures.push("late audience pageerror: "+e.message));
  await late.goto(base+"/?bundle="+bundle+"#audience");
  await late.waitForFunction(()=>document.querySelector(".cognitive-card-stage")?.textContent?.includes("نقاش مجموعات"),null,{timeout:6000});
  check("late audience synchronized approved scene",true);
  await late.close();

  // Existing QR voting service: open exactly one scenario question; no parallel service.
  await whatif.getByRole("button",{name:"تصويت عبر QR الحالي"}).click();
  const frame=presenter.frameLocator("#vote-iframe");
  await frame.locator("#panel").waitFor({state:"visible",timeout:8000});
  await frame.locator("#polls .poll").first().waitFor({timeout:8000});
  const created = await frame.locator("#polls .poll").first().innerText();
  check("What If uses ordinary voting console",created.includes("أي أسلوب مناسب؟"));
  check("student voting URL remains the same", (await frame.locator("#join-url").innerText()).includes("/vote.html?s="));

  // Every requested display size receives a bounded stage without horizontal overflow.
  for (const [width,height] of [[1920,1080],[1366,768],[1280,720],[1024,768],[390,844]]) {
    await presenter.setViewportSize({width,height});
    const geometry=await presenter.evaluate(()=>{
      const stage=document.querySelector("#stage")?.getBoundingClientRect();
      return {stageWidth:stage?.width||0,viewport:innerWidth,scroll:document.documentElement.scrollWidth};
    });
    check("responsive presenter "+width+"x"+height,
      geometry.stageWidth>100 && geometry.stageWidth<=width+1 && geometry.scroll<=width+1,
      JSON.stringify(geometry));
  }
  await presenter.emulateMedia({reducedMotion:"reduce"});
  await whatif.getByRole("button",{name:"اعرض السؤال"}).click();
  const motion=await presenter.locator(".cognitive-node").first()
    .evaluate((element)=>getComputedStyle(element).animationName);
  check("reduced motion accepted", motion === "none", motion);

  // Open the knowledge section again: one tool section intentionally stays open at a time.
  await open(0);
  // Deterministic visual-only projection of an already aggregated paired pulse;
  // the linked server vote lifecycle has separate unit and privacy tests.
  await audience.evaluate(async (bundleId) => {
    const {renderCognitiveProjection} = await import("/living-intelligence-ui.js");
    const stage=document.getElementById("stage");
    renderCognitiveProjection(stage,{kind:"pulse",title:"قبل وبعد الشرح",bundle:bundleId,
      slide:1,step:0,question:"ما الفرق بين أسلوبين؟",totals:[10,12],values:[
        {option:"التعلم التعاوني",firstPercent:40,lastPercent:75,deltaPoints:35},
        {option:"التعلم الفردي",firstPercent:60,lastPercent:25,deltaPoints:-35}
      ]});
  },bundle);
  check("real paired-pulse visual has distinct before and after bars",
    await audience.locator(".cognitive-pulse-item").count()===2 &&
    await audience.locator(".cognitive-pulse-fill.before").count()===2 &&
    await audience.locator(".cognitive-pulse-fill.after").count()===2);
  if(shots) await audience.locator("#stage").screenshot({path:join(shots,"pulse-comparison.png")});
  await presenter.locator("#home").click();
  await audience.evaluate(()=>document.querySelector(".cognitive-projection")?.remove());

  // Projector premiere: visual fidelity is checked in real Chromium at room-size viewports.
  const room=await context.newPage();
  room.on("pageerror",(e)=>failures.push("room pageerror: "+e.message));
  await room.goto(base+"/?bundle="+bundle+"#audience");
  await room.waitForSelector("#stage");
  const longPhrase="الألعاب التعليمية تعزز الدافعية لدى الطلاب وتدعم المناقشة العملية من خلال أمثلة معتمدة. ";
  await room.evaluate(async (arg)=>{
    const {renderCognitiveProjection}=await import("/living-intelligence-ui.js");
    const {roomKnowledgePages}=await import("/cognitive-readability.js");
    const graph={nodes:[
      {id:"n1",type:"topic",text:"الألعاب التعليمية"},
      {id:"n2",type:"concept",text:arg.phrase.repeat(3).trim()}
    ],edges:[{from:"n2",to:"n1",relation:"related"}]};
    const pages=roomKnowledgePages(graph);
    window.__roomPageCount=pages.length;
    const first=pages[0];
    renderCognitiveProjection(document.getElementById("stage"),{
      kind:"living",title:"خريطة المعرفة",bundle:arg.bundle,slide:1,step:0,
      page:0,pages:pages.length,nodes:first.nodes,edges:first.edges
    });
  },{bundle,phrase:longPhrase});
  check("long original text is paginated rather than silently cut",
    await room.evaluate(()=>window.__roomPageCount)>1);
  for(const [width,height] of [[1920,1080],[1366,768],[1280,720],[1024,768]]){
    await room.setViewportSize({width,height});
    await room.waitForTimeout(190);
    const quality=await room.evaluate(()=>{
      const layer=document.querySelector(".cognitive-card-stage");
      const nodes=[...layer.querySelectorAll(".cognitive-node p")];
      const fonts=nodes.map((n)=>parseFloat(getComputedStyle(n).fontSize));
      const fit=nodes.map((node)=>{
        const target=node.closest(".cognitive-node").getBoundingClientRect();
        const range=document.createRange();range.selectNodeContents(node);
        const rects=[...range.getClientRects()].filter((r)=>r.width>0&&r.height>0);
        return rects.length>0 && rects.every((r)=>r.left>=target.left-3 &&
          r.right<=target.right+3 && r.top>=target.top-3 && r.bottom<=target.bottom+3);
      });
      return {fit:layer.dataset.roomFit,clipped:fit.some((x)=>!x),fonts,
        screen:{w:document.documentElement.scrollWidth,h:document.documentElement.scrollHeight}};
    });
    check("projector legibility "+width+"x"+height,
      quality.fit==="ok"&&!quality.clipped&&quality.fonts.every((x)=>x>=19),
      JSON.stringify(quality));
    if(shots)await room.locator("#stage").screenshot({path:join(shots,"premiere-living-"+width+".png")});
  }
  await room.evaluate(async (bundleId)=>{
    const {renderCognitiveProjection}=await import("/living-intelligence-ui.js");
    renderCognitiveProjection(document.getElementById("stage"),{
      kind:"whatif",title:"قرار النشاط",question:"كيف نختار طريقة التعلم في هذا الموقف؟",
      bundle:bundleId,slide:1,step:0,
      options:["نشاط تعاوني","نشاط فردي"],revealed:true,chosen:0,
      result:("وصف النتيجة المعتمدة: تطبيق نشاط تعاوني وفق السيناريو الذي كتبه المحاضر. ").repeat(7),
      resultPart:0
    });
  },bundle);
  await room.setViewportSize({width:1366,height:768});
  await room.waitForTimeout(170);
  check("authored long outcomes are shown as legible sequenced excerpts",
    await room.locator(".cognitive-outcome small").innerText().then((s)=>s.includes("جزء 1 من")));
  const size=await room.locator(".cognitive-revealed-result").evaluate((node)=>({
    clipped:(()=>{
      const box=node.closest(".cognitive-outcome").getBoundingClientRect();
      const range=document.createRange();range.selectNodeContents(node);
      return [...range.getClientRects()].some((r)=>r.width>0&&r.height>0&&
        (r.left<box.left-3||r.right>box.right+3||r.top<box.top-3||r.bottom>box.bottom+3));
    })(),font:parseFloat(getComputedStyle(node).fontSize)
  }));
  check("premiere outcome remains legible at standard projector resolution",
    !size.clipped && size.font>=21,JSON.stringify(size));
  if(shots)await room.locator("#stage").screenshot({path:join(shots,"premiere-decision.png")});
  await room.close();

  // Browser download keeps approved lecturer data private; importing it requires
  // explicit confirmation, validates bundle ID, and never projects automatically.
  check("private backup import picker is hidden until explicitly invoked",
    await newLiving.locator('input[type="file"]').isHidden());
  const downloadReady = presenter.waitForEvent("download");
  await newLiving.getByRole("button",{name:"صدّر نسخة خاصة"}).click();
  const download = await downloadReady;
  const rawBackup = readFileSync(await download.path(), "utf8");
  const backup = JSON.parse(rawBackup);
  check("private JSON backup includes approved graph and authored scenarios",
    backup.format === "alfa-living-backup" && backup.bundle === bundle &&
    backup.graph.nodes.length >= 2 && backup.scenarios.some((s)=>s.title==="قرار النشاط"));
  presenter.once("dialog", (dialog) => dialog.accept());
  await newLiving.locator('input[type="file"]').setInputFiles({
    name: "alfa-private.json", mimeType: "application/json", buffer: Buffer.from(rawBackup)
  });
  await presenter.waitForFunction(() => document.querySelector("#cognitive-drawer > .meta")
    ?.textContent?.includes("استُعيدت الشبكة"));
  check("valid archive imports locally with explicit approval", true);
  check("import never broadcasts private archive content",
    await audience.locator(".cognitive-card-stage").count()===0);
} catch (error) {
  console.error(error);
  failures.push("exception: "+error.message);
} finally {
  await browser.close();
  server.kill();
}
if (failures.length) {console.error("Living e2e failures:",failures);process.exit(1);}
console.log("Living Intelligence Chromium scenarios passed");
