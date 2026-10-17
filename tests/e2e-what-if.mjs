// Chromium smoke test for the static, lecturer-approved what-if SVG.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { renderInfographic } from "../web/infographic.js";
const svg = renderInfographic({ type: "whatif", title: "مقارنة افتراضية",
  lines: ["30%", "50%"] });
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: ["--no-sandbox"]
});
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  await page.setContent(svg);
  const result = await page.evaluate(() => {
    const root = document.querySelector("svg");
    const rects = [...root.querySelectorAll('rect[height="28"]')];
    return { label: root.getAttribute("aria-label"), text: root.textContent,
      viewBox: root.getAttribute("viewBox"), barWidths: rects.map(el => Number(el.getAttribute("width"))),
      bodyWidth: root.getBoundingClientRect().width };
  });
  assert.equal(result.viewBox, "0 0 960 540");
  assert.ok(result.label.includes("مقارنة افتراضية"));
  assert.ok(result.text.includes("30%") && result.text.includes("50%"));
  assert.ok(result.text.includes("ليست نتيجة متوقعة"));
  assert.deepEqual(result.barWidths, [290, 87, 290, 145],
    "each hypothetical bar scales to 100%, not to the larger spoken value");
  assert.ok(result.bodyWidth > 0);
  assert.deepEqual(errors, []);
  console.log("Chromium: grounded what-if SVG rendered without runtime errors");
} finally {
  await browser.close();
}
