/**
 * dump localStorage —— 把开发服务器里的浏览器存储导出成 JSON，供分析布局 schema。
 * 用法：node tools/rack3d-ls-dump.mjs
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const URL = process.env.RACK3D_URL ?? "http://localhost:5173/";
const OUT = process.env.RACK3D_OUT ?? process.cwd();

const executablePath = CANDIDATES.find((p) => existsSync(p));
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(7000);

const dump = await page.evaluate(() => {
  const out = {};
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i) ?? "";
    out[k] = localStorage.getItem(k) ?? "";
  }
  return out;
});

writeFileSync(join(OUT, "_ls.json"), JSON.stringify(dump, null, 2), "utf8");
console.log("keys:", Object.keys(dump).join(", "));
await browser.close();
