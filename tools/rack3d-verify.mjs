/**
 * Rack3D 端到端验证脚本
 * ---------------------------------------------------------------------------
 * 用项目自带的 playwright-core 驱动本机已安装的 Edge（channel: msedge），
 * 免去下载 Chromium。脚本做四件事：
 *   1. 打开开发服务器，收集 console / pageerror
 *   2. 截图初始界面，并 dump 可见文本（用于校验汉化词典层是否生效）
 *   3. 切到右侧「实时数据映射」页签，截图
 *   4. 打开 3D 机柜查看模块，截图
 *
 * 用法：
 *   node tools/rack3d-verify.mjs
 * 环境变量：
 *   RACK3D_URL  默认 http://localhost:5173/
 *   RACK3D_OUT  截图输出目录，默认当前工作目录
 */

import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { join } from "node:path";

const CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

const URL = process.env.RACK3D_URL ?? "http://localhost:5173/";
const OUT = process.env.RACK3D_OUT ?? process.cwd();

const executablePath = CANDIDATES.find((p) => existsSync(p));
if (!executablePath) {
  console.error("找不到 msedge.exe，请检查 Edge 安装路径");
  process.exit(2);
}

const logs = [];
const steps = [];

const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });

page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") {
    logs.push(`[${m.type()}] ${m.text()}`);
  }
});
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

async function shot(name) {
  try {
    await page.screenshot({ path: join(OUT, name) });
    steps.push(`screenshot ok: ${name}`);
  } catch (e) {
    steps.push(`screenshot FAIL ${name}: ${e.message}`);
  }
}

try {
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(6000);

  // ---- 1. 初始界面 ----
  const text1 = await page.evaluate(() => document.body.innerText || "");
  steps.push(`baseline text length: ${text1.length}`);
  steps.push("baseline text (first 1200 chars):\n" + text1.slice(0, 1200));
  await shot("shot-1-baseline.png");

  // 语言属性
  const lang = await page.evaluate(() => document.documentElement.lang);
  steps.push(`html lang = ${lang}`);

  // ---- 2. 切到「实时数据映射」页签 ----
  const telemetryTab = page
    .locator('[data-testid="side-panel-tab-telemetry"]')
    .or(page.getByRole("tab", { name: /Telemetry|实时数据映射/ }));
  try {
    await telemetryTab.first().click({ timeout: 8000 });
    await page.waitForTimeout(1500);
    steps.push("telemetry tab clicked");
  } catch (e) {
    steps.push(`telemetry tab click FAIL: ${e.message}`);
  }
  const text2 = await page.evaluate(() => document.body.innerText || "");
  steps.push("after-telemetry text (first 1500 chars):\n" + text2.slice(0, 1500));
  await shot("shot-2-telemetry.png");

  // ---- 3. 打开 3D 机柜查看 ----
  const launcher = page.locator('button[aria-label="3D Rack View"]');
  try {
    await launcher.first().click({ timeout: 8000 });
    await page.waitForTimeout(3500);
    steps.push("3D launcher clicked");
  } catch (e) {
    steps.push(`3D launcher click FAIL: ${e.message}`);
  }
  const webgl = await page.evaluate(() => {
    const c = document.querySelector(".rack3d-viewport canvas");
    if (!c) return "no canvas";
    const gl =
      c.getContext("webgl2") || c.getContext("webgl") || null;
    return `canvas ${c.width}x${c.height} ctx=${gl ? "ok" : "none"}`;
  });
  steps.push(`3D canvas check: ${webgl}`);
  await shot("shot-3-3d.png");

  // ---- 4. 两张 2D+3D 并存总览 ----
  await page.waitForTimeout(1000);
  await shot("shot-4-overview.png");
} catch (e) {
  steps.push(`FATAL: ${e.message}`);
} finally {
  await browser.close();
}

console.log("=== STEPS ===");
console.log(steps.join("\n"));
console.log("\n=== CONSOLE / ERRORS (" + logs.length + ") ===");
console.log(logs.slice(0, 60).join("\n"));
