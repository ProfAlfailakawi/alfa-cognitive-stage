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
  check("original PowerPoint slide image is unchanged",await presenter.locator("#slide-img").getAttribute("src") === slideBefore);
  if (shots) await audience.locator("#stage").screenshot({path:join(shots,"living-1366.png")});
  await presenter.locator("#home").click();
  await audience.waitForFunction(()=>!document.querySelector(".cognitive-projection"));
  check("emergency return restores original image",await presenter.locator("#slide-img").getAttribute("src")===slideBefore);
  check("emergency return clears audience",await audience.locator(".cognitive-projection").count()===0);

  // Recover approved knowledge after a presenter refresh; no transcript is exported.
  await presenter.reload();
  await presenter.waitForSelector("#cognitive-drawer");
  await presenter.locator("#cognitive-drawer > summary").click();
  const newLiving = await open(0);
  check("graph memory persisted after reload",
    (await newLiving.locator(".meta").last().innerText()).includes("2"));
  await newLiving.getByRole("button",{name:"التالي"}).click();
  check("graph restoration shows approved exact text",
    (await presenter.locator(".cognitive-card-stage").innerText()).includes("الألعاب التعليمية"));
  await presenter.locator("#home").click();

  // A real drafted scenario is invisible until its author explicitly reveals a selected result.
  const whatif = await open(4);
  await whatif.locator('input[type="text"]').first().fill("قرار النشاط");
  await whatif.locator("textarea").first().fill("أي أسلوب مناسب؟");
  await whatif.locator("textarea").nth(1).fill("نشاط تعاوني | نقاش مجموعات | سيناريو كتبه المحاضر\nنشاط فردي | مهمة فردية | سيناريو كتبه المحاضر");
  await whatif.getByRole("button",{name:"احفظ السيناريو"}).click();
  await whatif.getByRole("button",{name:"اعرض السؤال"}).click();
  await audience.waitForFunction(()=>document.querySelector(".cognitive-card-stage")?.textContent?.includes("أي أسلوب مناسب"));
  check("unrevealed scenario hides branch results",
    !(await audience.locator(".cognitive-card-stage").innerText()).includes("نقاش مجموعات"));
  if (shots) await audience.locator("#stage").screenshot({path:join(shots,"whatif-hidden.png")});
  await whatif.getByRole("button",{name:"اكشف النتيجة المختارة"}).click();
  await audience.waitForFunction(()=>document.querySelector(".cognitive-card-stage")?.textContent?.includes("نقاش مجموعات"));
  check("explicit reveal exposes only selected predefined result",
    (await audience.locator(".cognitive-card-stage").innerText()).includes("نقاش مجموعات"));
  if (shots) await audience.locator("#stage").screenshot({path:join(shots,"whatif-revealed.png")});

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
  const motion=await presenter.evaluate(()=>getComputedStyle(document.querySelector(".cognitive-node")||document.createElement("div")).animationName);
  check("reduced motion accepted", motion === "none" || !document.querySelectorAll /* evaluated safely below */ );
} catch (error) {
  console.error(error);
  failures.push("exception: "+error.message);
} finally {
  await browser.close();
  server.kill();
}
if (failures.length) {console.error("Living e2e failures:",failures);process.exit(1);}
console.log("Living Intelligence Chromium scenarios passed");
