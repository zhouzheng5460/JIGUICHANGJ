/** 取样 3D 画布像素，用于定位"颜色不对"的渲染问题 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const EDGE = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 950 } });
await page.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(7000);

// 直接用仓库里的演示数据
await page.evaluate(() => {
  localStorage.removeItem("rack3d_scene_props");
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(7000);

await page.locator(".rack3d-launcher").first().click({ timeout: 8000 });
await page.waitForTimeout(4000);
await page.selectOption(".view-select", "top");
await page.waitForTimeout(1500);
await page.mouse.move(10, 930);
await page.waitForTimeout(300);

const sample = await page.evaluate(() => {
  const c = document.querySelector(".rack3d-viewport canvas");
  const tmp = document.createElement("canvas");
  tmp.width = c.width;
  tmp.height = c.height;
  const ctx = tmp.getContext("2d");
  ctx.drawImage(c, 0, 0);
  const at = (fx, fy) => {
    const x = Math.round(c.width * fx);
    const y = Math.round(c.height * fy);
    const d = ctx.getImageData(x, y, 1, 1).data;
    return `(${fx.toFixed(2)},${fy.toFixed(2)}) = #${[d[0], d[1], d[2]]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("")}`;
  };
  const out = [];
  for (const fy of [0.25, 0.35, 0.45, 0.55, 0.65]) {
    for (const fx of [0.3, 0.5, 0.7, 0.9]) out.push(at(fx, fy));
  }
  return { size: `${c.width}x${c.height}`, out };
});
console.log(JSON.stringify(sample, null, 2));
await page.screenshot({ path: "G:\\Rackula-main\\Rackula-main\\verify-out\\probe-top.png" });
await browser.close();
