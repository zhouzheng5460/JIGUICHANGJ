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

await page.locator(".rack3d-launcher").first().click({ timeout: 8000 });
await page.waitForTimeout(3000);
// 关键：把鼠标移出面板，排除 :hover 干扰
await page.mouse.move(10, 930);
await page.waitForTimeout(400);

const r = await page.evaluate(() => {
  const pick = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      cls: el.getAttribute("class"),
      color: cs.color,
      bg: cs.backgroundColor,
      borderTop: cs.borderTopColor,
      borderStyle: cs.borderTopStyle,
      w: cs.width,
      h: cs.height,
    };
  };
  // hover 状态确认
  const hovered = Array.from(document.querySelectorAll(":hover")).map(
    (e) => e.tagName + "." + String(e.className).slice(0, 40),
  );
  return {
    panel: pick(".rack3d-panel"),
    title: pick(".rack3d-title"),
    close: pick(".rack3d-close"),
    popupClose: pick(".popup-close"),
    footBtn: pick(".foot-btn"),
    hovered,
    redCount: document.querySelectorAll("*").length,
  };
});
console.log(JSON.stringify(r, null, 2));
await page.screenshot({ path: "G:\\Rackula-main\\Rackula-main\\verify-out\\opt-1b-colours-nohover.png" });
await browser.close();
