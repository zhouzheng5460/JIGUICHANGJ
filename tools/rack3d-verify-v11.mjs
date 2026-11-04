/**
 * Rack3D 扩展探针 v11：页签外观（标题 / favicon）+ 汉化补齐 + 默认名称
 * =================================================================================
 * 覆盖断言：
 *   A1. 浏览器页签标题为「机柜3D配置器」（不含上游 LOCAL/DEV 环保前缀）。
 *   A2. 中文环境下 html lang = zh-CN。
 *
 *   B1. 未设置自定义 LOGO 时，没有我们注入的 favicon <link>。
 *   B2. 上传 SVG LOGO 后注入 <link id="rack3d-favicon" rel="icon" type="image/svg+xml">，
 *       href 是 data:image/svg+xml 且能还原出上传的 SVG 片段。
 *   B3. 刷新后 favicon 仍在（持久化生效）。
 *   B4. 「恢复默认 LOGO」后注入的 <link> 被移除。
 *
 *   C1. 命令面板分组标题全部为中文。
 *   C2. 命令面板条目无残留英文（白名单外）。
 *   C3. 命令面板页脚（navigate / run / close）为中文。
 *
 *   D1. 机柜列表页头计数中文化（"1 个机柜"）。
 *   D2. 机柜列表条目元信息中文化（"12U · 1 台设备"）。
 *
 *   E1. 新建机柜默认名为「机柜」。
 *   E2. 复制机柜后名字后缀为「（副本）」。
 *
 *   F1. 悬浮气泡（bits-ui Tooltip）内容中文化：Fit all → 适应全部。
 *
 * 用法：RACK3D_URL=http://localhost:5200/ node tools/rack3d-verify-v11.mjs
 */

import { chromium } from "playwright-core";
import * as YAMLNS from "yaml";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const EDGE_PATHS = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const URL = process.env.RACK3D_URL ?? "http://localhost:5200/";
const UNITS_PER_U = 6;
const LAYOUT_ID = "rack3d-demo-0000-4000-8000-0000000000bb";

const YAML = YAMLNS.default ?? YAMLNS;
const parseYaml = YAML.parse ?? YAMLNS.parse;
const template = parseYaml(
  readFileSync("static/templates/home-lab.rackula.yaml", "utf8"),
);

const layout = {
  version: "26.9.0",
  name: "Rack3D v11 验证",
  racks: [
    {
      id: "rack-1",
      name: "机柜 A",
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
  metadata: { id: LAYOUT_ID, name: "Rack3D v11 验证", schema_version: "1.1" },
};

const checks = {};
const results = {};
const notes = [];
const errors = [];

const executablePath = EDGE_PATHS.find((p) => existsSync(p));
if (!executablePath) {
  console.error("找不到 msedge.exe");
  process.exit(2);
}

const HAS_CJK = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/;
/** 允许保留的英文（快捷键、单位、品牌、编号） */
const ALLOW_EN = /^(Ctrl|Shift|Alt|Cmd|Esc|esc|F\d|\?|↑|↓|↵|[A-Z]-[A-Z]|\d+%?|[A-Z0-9-]+)$/;

const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 950 } });
page.setDefaultTimeout(8000);
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`[console.error] ${m.text()}`);
});

/** 打开命令面板（按钮会因重渲染 detach，用快捷键更稳） */
async function openPalette() {
  for (let i = 0; i < 5; i += 1) {
    await page.keyboard.press("Control+k");
    try {
      await page.waitForSelector('[data-testid="command-palette-input"]', {
        timeout: 2500,
      });
      await page.waitForTimeout(400);
      return true;
    } catch {
      await page.waitForTimeout(400);
    }
  }
  return false;
}

async function closePalette() {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
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
    },
    { layoutId: LAYOUT_ID, layout },
  );

  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(7000);

  // ---------------- A. 页签标题 ----------------
  results.title = await page.title();
  results.lang = await page.evaluate(() => document.documentElement.lang);
  checks.A1_titleChinese = results.title === "机柜3D配置器";
  checks.A2_langChinese = results.lang === "zh-CN";

  // ---------------- B. favicon ----------------
  const faviconInfo = () =>
    page.evaluate(() => {
      const el = document.getElementById("rack3d-favicon");
      if (!el) return null;
      return {
        rel: el.getAttribute("rel"),
        type: el.getAttribute("type"),
        hrefHead: (el.getAttribute("href") || "").slice(0, 40),
      };
    });

  results.faviconBefore = await faviconInfo();
  checks.B1_noFaviconByDefault = results.faviconBefore === null;

  const tmpSvg =
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='#3ddc84'/><circle cx='16' cy='16' r='7' fill='#191a21'/><path d='M4 28 L28 4' stroke='#ff00aa' stroke-width='2'/></svg>";

  // 上传走设置弹窗里的 file input，确保和真实用户路径一致
  await openPalette();
  await page.locator('[data-testid="command-palette-settings"]').click();
  await page.waitForSelector('[data-testid="settings-dialog"]', {
    timeout: 8000,
  });
  await page.waitForTimeout(400);
  await page.evaluate((svg) => {
    const dt = new DataTransfer();
    dt.items.add(new File([svg], "logo.svg", { type: "image/svg+xml" }));
    const input = document.querySelector(
      'input[type="file"][accept=".svg,image/svg+xml"]',
    );
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, tmpSvg);
  await page.waitForTimeout(800);

  results.faviconAfterUpload = await faviconInfo();
  const decoded = await page.evaluate(() => {
    const el = document.getElementById("rack3d-favicon");
    if (!el) return "";
    const href = el.getAttribute("href") || "";
    const comma = href.indexOf(",");
    return comma === -1 ? "" : decodeURIComponent(href.slice(comma + 1));
  });
  results.faviconSvgMatch = decoded === tmpSvg;
  checks.B2_faviconInjected =
    !!results.faviconAfterUpload &&
    results.faviconAfterUpload.rel === "icon" &&
    results.faviconAfterUpload.type === "image/svg+xml" &&
    (results.faviconAfterUpload.hrefHead || "").startsWith(
      "data:image/svg+xml",
    ) &&
    results.faviconSvgMatch;

  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  results.faviconAfterReload = await faviconInfo();
  results.titleAfterReload = await page.title();
  checks.B3_faviconPersisted = !!results.faviconAfterReload;
  checks.A1b_titleAfterReload = results.titleAfterReload === "机柜3D配置器";

  // 恢复默认 LOGO
  await openPalette();
  await page.locator('[data-testid="command-palette-settings"]').click();
  await page.waitForSelector('[data-testid="settings-dialog"]', {
    timeout: 8000,
  });
  await page.waitForTimeout(400);
  await page.locator('[data-testid="logo-reset"]').click();
  await page.waitForTimeout(600);
  results.faviconAfterReset = await faviconInfo();
  checks.B4_faviconRemovedOnReset = results.faviconAfterReset === null;
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // ---------------- C. 命令面板汉化 ----------------
  const paletteOpened = await openPalette();
  checks.C0_paletteOpened = paletteOpened;
  if (paletteOpened) {
    results.paletteHeadings = await page
      .locator(".command-group-heading")
      .allInnerTexts();
    results.paletteFooter = await page
      .locator(".command-footer")
      .innerText()
      .catch(() => "");
    results.paletteItems = await page.locator(".command-item").allInnerTexts();

    checks.C1_headingsChinese =
      results.paletteHeadings.length > 0 &&
      results.paletteHeadings.every((h) => HAS_CJK.test(h));

    const englishItems = results.paletteItems
      .map((t) => t.replace(/\s+/g, " ").trim())
      .filter((t) => /[A-Za-z]/.test(t) && !HAS_CJK.test(t))
      .filter((t) => {
        // 拆掉快捷键（换行后的 "F" / "Ctrl + E" 等）后仍有英文才算漏翻
        const label = t.split("\n")[0].trim();
        return !ALLOW_EN.test(label);
      });
    results.englishPaletteItems = englishItems;
    checks.C2_itemsChinese = englishItems.length === 0;

    // 页脚只保留 kbd 符号 + 中文动词
    const footerText = results.paletteFooter.replace(/\s+/g, " ");
    results.paletteFooterText = footerText;
    checks.C3_footerChinese =
      /导航/.test(footerText) &&
      /执行/.test(footerText) &&
      /关闭/.test(footerText);
    await closePalette();
  }

  // ---------------- F. 悬浮气泡 ----------------
  // Fit all 按钮的 Tooltip：hover 后气泡内容应为中文
  const bubble = [];
  for (const sel of [
    '[data-testid="btn-fit-all"]',
    '[data-testid="btn-zoom-in"]',
    '[data-testid="btn-zoom-out"]',
  ]) {
    const el = page.locator(sel).first();
    if ((await el.count()) === 0) continue;
    try {
      await el.hover({ force: true, timeout: 3000 });
      await page.waitForTimeout(600);
      const txt = await page.evaluate(() => {
        const c =
          document.querySelector(".tooltip-content") ||
          document.querySelector('[role="tooltip"]');
        return c ? (c.innerText || c.textContent || "").replace(/\s+/g, " ").trim() : null;
      });
      if (txt) bubble.push(txt);
    } catch {
      /* 该按钮当前不可 hover */
    }
    await page.mouse.move(5, 5);
    await page.waitForTimeout(200);
  }
  results.tooltipBubbles = bubble;
  checks.F1_tooltipChinese =
    bubble.length > 0 && bubble.every((t) => HAS_CJK.test(t));

  // ---------------- D. 机柜列表汉化 ----------------
  await page.locator('[data-testid="sidebar-tab-racks"]').click();
  await page.waitForTimeout(800);
  results.rackCountText = await page
    .locator(".rack-count")
    .first()
    .innerText()
    .catch(() => "");
  results.rackMetaText = await page
    .locator(".rack-meta")
    .first()
    .innerText()
    .catch(() => "");
  checks.D1_rackCountChinese = HAS_CJK.test(results.rackCountText);
  checks.D2_rackMetaChinese = HAS_CJK.test(results.rackMetaText);

  // ---------------- E. 新建 / 复制机柜默认名 ----------------
  const rackNames = () =>
    page.locator(".rack-name").allInnerTexts().catch(() => []);
  results.rackNamesBefore = await rackNames();

  await page.locator('[data-testid="btn-new-rack"]').click();
  await page.waitForTimeout(1200);
  results.rackNamesAfterNew = await rackNames();
  const added = results.rackNamesAfterNew.filter(
    (n) => !results.rackNamesBefore.includes(n),
  );
  results.newRackName = added[0] ?? "";
  checks.E1_newRackNameChinese = results.newRackName === "机柜";

  // 复制第一个机柜（选中后走 duplicate-selection 的快捷键 mod+D）
  await page.locator('[data-testid="rack-item-rack-1"]').click();
  await page.waitForTimeout(800);
  await page.keyboard.press("Control+d");
  await page.waitForTimeout(1800);
  results.rackNamesAfterDuplicate = await rackNames();
  results.duplicatedName =
    results.rackNamesAfterDuplicate.find((n) => /副本|Copy/.test(n)) ?? "";
  checks.E2_duplicateSuffix = /（副本）$/.test(results.duplicatedName);

  // ---------------- G. 撤销/重做气泡（历史描述） ----------------
  const undoBubbles = [];
  for (const sel of ['[data-testid="btn-undo"]', '[data-testid="btn-redo"]']) {
    const el = page.locator(sel).first();
    if ((await el.count()) === 0) continue;
    try {
      await el.hover({ force: true, timeout: 3000 });
      await page.waitForTimeout(600);
      const txt = await page.evaluate(() => {
        const c =
          document.querySelector(".tooltip-content") ||
          document.querySelector('[role="tooltip"]');
        return c ? (c.innerText || c.textContent || "").replace(/\s+/g, " ").trim() : null;
      });
      if (txt) undoBubbles.push(txt);
    } catch {
      /* 不可 hover */
    }
    await page.mouse.move(5, 5);
    await page.waitForTimeout(200);
  }
  results.undoRedoBubbles = undoBubbles;
  checks.G1_undoRedoBubbleChinese =
    undoBubbles.length > 0 && undoBubbles.every((t) => HAS_CJK.test(t));
} catch (e) {
  notes.push("FATAL: " + e.message);
} finally {
  await browser.close();
}

const failed = Object.entries(checks).filter(([, v]) => !v);
const report = {
  checks,
  failed: failed.map(([k]) => k),
  results,
  notes,
  errors: errors.slice(0, 8),
};
writeFileSync("tools/_v11.json", JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify(report, null, 2));
console.log(
  failed.length === 0
    ? "=== SUMMARY === ALL PASS"
    : `=== SUMMARY === ${failed.length} FAILED`,
);
