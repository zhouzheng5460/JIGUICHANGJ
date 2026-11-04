/**
 * 页面加载体检：用全新(无扩展、空缓存)的 Edge 实例打开 dev server，
 * 判断"页面报错"到底来自应用本身，还是用户浏览器的缓存/扩展。
 *
 * 用法：node tools/e2e.mjs tools/probe-load.mjs
 * 输出：控制台错误、失败请求、资源状态、应用是否渲染、3D 是否可用。
 */

import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const EDGE_PATHS = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const URL = process.env.RACK3D_URL ?? "http://localhost:5173/";

const executablePath = EDGE_PATHS.find((p) => existsSync(p));
if (!executablePath) {
  console.error("找不到 msedge.exe");
  process.exit(2);
}

const pageErrors = [];
const consoleErrors = [];
const failedRequests = [];
const depResponses = [];
const nonOkResponses = [];

const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 950 } });

page.on("pageerror", (e) => pageErrors.push(e.message));
page.on("console", (m) => {
  const t = m.text();
  if (m.type() === "error") consoleErrors.push(t);
});
page.on("requestfailed", (r) => {
  failedRequests.push(`${r.failure()?.errorText ?? "?"} ${r.url()}`);
});
page.on("response", (r) => {
  const u = r.url();
  if (u.includes("/node_modules/.vite/deps/")) {
    depResponses.push(`${r.status()} ${u.split("/").pop()}`);
  } else if (r.status() >= 400) {
    nonOkResponses.push(`${r.status()} ${u}`);
  }
});

const report = {};
try {
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(9000);

  report.bodyTextLength = await page.evaluate(() => document.body.innerText.length);
  report.htmlLang = await page.evaluate(() => document.documentElement.lang);

  // 打开 3D 面板
  let threePanelOk = false;
  try {
    await page.locator(".rack3d-launcher").first().click({ timeout: 8000 });
    await page.waitForTimeout(6000);
    threePanelOk = true;
  } catch (e) {
    report.launcherError = e.message;
  }
  report.threePanelOpened = threePanelOk;

  // 3D 画布是否真的画出东西（Three.js 未初始化时 canvas 会停在 300x150 且全空）
  report.three3d = await page.evaluate(() => {
    const c = document.querySelector(".rack3d-viewport canvas");
    if (!c || !c.width) return null;
    const tmp = document.createElement("canvas");
    const w = Math.min(c.width, 900);
    const h = Math.min(c.height, 1400);
    tmp.width = w;
    tmp.height = h;
    const ctx = tmp.getContext("2d");
    ctx.drawImage(c, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    let nonBg = 0;
    for (let i = 0; i < d.length; i += 4) {
      // 暗色主题背景 #15171d
      if (Math.abs(d[i] - 21) > 14 || Math.abs(d[i + 1] - 23) > 14 || Math.abs(d[i + 2] - 29) > 14) {
        nonBg += 1;
      }
    }
    return {
      natural: `${c.width}x${c.height}`,
      nonBgPct: +((nonBg / (w * h)) * 100).toFixed(2),
    };
  });

  report.controllerReady = await page.evaluate(() => !!window.__rack3d);
} catch (e) {
  report.FATAL = e.message;
} finally {
  await browser.close();
}

report.pageErrors = pageErrors;
report.consoleErrors = consoleErrors;
report.failedRequests = failedRequests;
report.nonOkResponses = nonOkResponses;
report.depResponses = depResponses;

console.log("=== LOAD REPORT ===\n" + JSON.stringify(report, null, 2));
