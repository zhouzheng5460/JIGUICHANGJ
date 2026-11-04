/**
 * Rack3D 扩展探针 v10：设置弹窗 · 界面配色方案 + LOGO 替换
 * =================================================================================
 * 覆盖断言：
 *   A1. 点击 ocean 色板 → <html data-app-theme="ocean">。
 *   A2. --colour-bg 实际取值随主题变化（CSS 变量覆盖生效）。
 *   A3. 刷新后仍为 ocean（localStorage Rackula_app_theme 持久化 + main.ts 预挂载应用）。
 *   B1. 切回 dracula → data-app-theme 属性移除（默认配色）。
 *   C0. 无自定义 LOGO 时「恢复默认」按钮禁用。
 *   C1/C2. 经 input.change 上传 SVG → .logo-mark-custom 渲染 + Rackula_custom_logo 入库。
 *   C3. 关闭弹窗后 Toolbar 内同样渲染自定义 LOGO（LogoLockup 响应式）。
 *   C4. 恢复默认 → 自定义 LOGO 移除、localStorage 键删除。
 *
 * 用法：node tools/e2e.mjs tools/rack3d-verify-v10.mjs
 */

import { chromium } from "playwright-core";
import * as YAMLNS from "yaml";
import { existsSync, readFileSync } from "node:fs";

const EDGE_PATHS = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const URL = process.env.RACK3D_URL ?? "http://localhost:5173/";
const UNITS_PER_U = 6;
const LAYOUT_ID = "rack3d-demo-0000-4000-8000-000000000010";

const YAML = YAMLNS.default ?? YAMLNS;
const parseYaml = YAML.parse ?? YAMLNS.parse;
const template = parseYaml(
  readFileSync("static/templates/home-lab.rackula.yaml", "utf8"),
);

const layout = {
  version: "26.9.0",
  name: "Rack3D v10 验证",
  racks: [
    {
      id: "rack-1",
      name: "机柜 A / 主柜",
      height: 12,
      width: 19,
      desc_units: false,
      show_rear: true,
      form_factor: "4-post-cabinet",
      starting_unit: 1,
      position: 0,
      view: "front",
      devices: [
        {
          id: "dev-server-1",
          device_type: "1u-server",
          name: "应用服务器",
          position: 9 * UNITS_PER_U,
          face: "front",
        },
      ],
    },
  ],
  device_types: template.device_types,
  settings: template.settings,
  metadata: { id: LAYOUT_ID, name: "Rack3D v10 验证", schema_version: "1.1" },
};

const notes = [];
const results = {};
const checks = {};
const errors = [];

const executablePath = EDGE_PATHS.find((p) => existsSync(p));
if (!executablePath) {
  console.error("找不到 msedge.exe");
  process.exit(2);
}

const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 950 } });
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`[console.error] ${m.text()}`);
});

/** 打开设置弹窗：工具条胶囊 → 命令面板 → 齿轮 */
async function openSettings() {
  await page.locator('[data-testid="btn-command-palette"]').click();
  await page.waitForTimeout(600);
  await page.locator('[data-testid="command-palette-settings"]').click();
  await page.waitForSelector('[data-testid="settings-dialog"]', {
    timeout: 8000,
  });
  await page.waitForTimeout(300);
}

try {
  await page.addInitScript(
    ({ layoutId, layout }) => {
      localStorage.setItem(
        `Rackula:layout:${layoutId}`,
        JSON.stringify({
          schemaVersion: 2,
          layout,
          savedAt: new Date().toISOString(),
          writerTabId: crypto.randomUUID(),
        }),
      );
      localStorage.setItem(
        "Rackula:workspace",
        JSON.stringify({
          schemaVersion: 2,
          activeId: layoutId,
          openTabs: [layoutId],
          library: {
            [layoutId]: {
              name: layout.name,
              updatedAt: new Date().toISOString(),
              changesSinceExport: 0,
              hasEverExported: false,
              lastExportedAt: null,
              writeFailed: false,
              storageMode: "browser",
            },
          },
        }),
      );
      localStorage.setItem("Rackula:everHadLayouts", "1");
      localStorage.setItem("rack3d_locale", "zh-CN");
      // 注意：不要在此清理 Rackula_app_theme / Rackula_custom_logo ——
      // addInitScript 在刷新时也会重跑，会把持久化设置抹掉导致 A3 误判；
      // 全新浏览器上下文本就无这些键。
    },
    { layoutId: LAYOUT_ID, layout },
  );

  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(6000);
  await page.locator(".rack3d-launcher").first().click({ timeout: 8000 });
  await page.waitForTimeout(4000);

  // ---------------- A. 配色方案 ----------------
  const bgBefore = await page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--colour-bg")
      .trim(),
  );
  results.bgBefore = bgBefore;

  await openSettings();
  results.themeOptions = await page
    .locator('[data-testid^="theme-option-"]')
    .count();

  await page.locator('[data-testid="theme-option-ocean"]').click();
  await page.waitForTimeout(300);
  results.dataThemeAfterOcean = await page.evaluate(
    () => document.documentElement.dataset.appTheme ?? "(none)",
  );
  const bgOcean = await page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--colour-bg")
      .trim(),
  );
  results.bgOcean = bgOcean;
  checks.A1_themeAttrApplied = results.dataThemeAfterOcean === "ocean";
  checks.A2_bgChanged = bgOcean !== bgBefore && bgOcean.length > 0;

  // A3. 刷新后保持（持久化）
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  results.dataThemeAfterReload = await page.evaluate(
    () => document.documentElement.dataset.appTheme ?? "(none)",
  );
  checks.A3_persistedAfterReload = results.dataThemeAfterReload === "ocean";

  // ---------------- B. 切回默认主题 ----------------
  await openSettings();
  await page.locator('[data-testid="theme-option-dracula"]').click();
  await page.waitForTimeout(300);
  results.dataThemeAfterDracula = await page.evaluate(
    () => document.documentElement.dataset.appTheme ?? "(none)",
  );
  checks.B1_draculaRemovesAttr = results.dataThemeAfterDracula === "(none)";

  // ---------------- C. LOGO 替换 ----------------
  results.logoStateBefore = await page
    .locator('[data-testid="logo-state"]')
    .textContent();
  checks.C0_resetDisabledByDefault = await page
    .locator('[data-testid="logo-reset"]')
    .isDisabled();

  const tmpSvg =
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><rect width='24' height='24' rx='4' fill='#3ddc84'/><circle cx='12' cy='12' r='5' fill='#191a21'/></svg>";
  await page.evaluate((svg) => {
    const dt = new DataTransfer();
    dt.items.add(
      new File([svg], "logo.svg", { type: "image/svg+xml" }),
    );
    const input = document.querySelector(
      'input[type="file"][accept=".svg,image/svg+xml"]',
    );
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, tmpSvg);
  await page.waitForTimeout(600);

  results.customLogoMarkCountInDialog = await page.locator(
    ".logo-mark-custom",
  ).count();
  const storedLogo = await page.evaluate(() =>
    localStorage.getItem("Rackula_custom_logo"),
  );
  checks.C1_customLogoRendered = results.customLogoMarkCountInDialog > 0;
  checks.C2_customLogoStored = !!storedLogo && storedLogo.includes("<svg");
  results.logoStateAfter = await page
    .locator('[data-testid="logo-state"]')
    .textContent();

  // 关闭弹窗 → Toolbar 同步渲染自定义 LOGO
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  checks.C3_toolbarShowsCustomLogo =
    (await page.locator(".logo-mark-custom").count()) > 0;

  // 恢复默认
  await openSettings();
  await page.locator('[data-testid="logo-reset"]').click();
  await page.waitForTimeout(500);
  const storedAfterReset = await page.evaluate(() =>
    localStorage.getItem("Rackula_custom_logo"),
  );
  checks.C4_resetRestoresDefault =
    (await page.locator(".logo-mark-custom").count()) === 0 &&
    storedAfterReset === null;

  // 收尾：主题回默认（不污染后续探针）
  await page.locator('[data-testid="theme-option-dracula"]').click();
  await page.waitForTimeout(200);
} catch (e) {
  notes.push("FATAL: " + e.message + "\n" + e.stack);
} finally {
  await browser.close();
}

console.log("=== NOTES ===");
console.log(notes.join("\n"));
console.log("=== RESULTS ===");
console.log(JSON.stringify(results, null, 2));
console.log("=== CHECKS ===");
console.log(JSON.stringify(checks, null, 2));
const failed = Object.entries(checks).filter(([, v]) => !v);
console.log(
  failed.length === 0
    ? "=== SUMMARY === ALL PASS"
    : `=== SUMMARY === ${failed.length} FAILED: ${failed.map(([k]) => k).join(", ")}`,
);
console.log(`=== ERRORS (${errors.length}) ===`);
console.log(errors.slice(0, 10).join("\n"));
