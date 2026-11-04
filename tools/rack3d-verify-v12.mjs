/**
 * Rack3D 扩展探针 v12：汉化补齐（第二批）
 * =================================================================================
 * 背景：v11 跑通后仍发现若干漏翻 —— 根因是 translator.resolve() 里
 * 「已含中文就跳过」的守卫把**中英混合**串（插值变量本身是中文，如
 * `Undo: Duplicate rack "机柜 A"`）误判成已翻译。本条探针覆盖修复后的表现。
 *
 * 覆盖断言：
 *   H1. 复制机柜后的撤销气泡整串中文（描述里的半截英文也被译掉），
 *       且没有残留 `Duplicate` / `rack` 之类英文词。
 *   H2. 关于/快捷键面板：分组标题、手势行动作、页脚「复制用于问题反馈」、
 *       「加拿大制造…」全部中文。
 *   H3. 设置弹窗：按钮与标签无残留英文（白名单外）。
 *   H4. 设备库分组切换：品牌 / 类别 / A-Z。
 *   H5. 布局库复制：新行名为「<原名> 副本」，提示为「已复制为 …」。
 *   H6. 轻提示中文化：复制机柜 →「机柜已复制」。
 *   H7. 存储状态标识（Browser → 浏览器）。
 *   H9. 轻提示 + 历史描述混合串：撤销 →「已撤销：新增机柜 “机柜 A（副本）”」，
 *       描述里的中文对象名不会让整串被判成"已翻译"而漏掉英文。
 *
 * 注：Ctrl+S（保存布局）动作在注册表里带 `storageMode: "server"`，
 * 浏览器模式下不可用、也就不会弹提示 —— 故不用它验证 toast。
 *
 * 用法：RACK3D_URL=http://localhost:5200/ node tools/rack3d-verify-v12.mjs
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
const LAYOUT_ID = "rack3d-demo-0000-4000-8000-0000000000cc";

const YAML = YAMLNS.default ?? YAMLNS;
const parseYaml = YAML.parse ?? YAMLNS.parse;
const template = parseYaml(
  readFileSync("static/templates/home-lab.rackula.yaml", "utf8"),
);

const layout = {
  version: "26.9.0",
  name: "Rack3D v12 验证",
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
  metadata: { id: LAYOUT_ID, name: "Rack3D v12 验证", schema_version: "1.1" },
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
/** 允许保留的英文（快捷键、单位、品牌、编号、专有名词） */
const ALLOW_EN =
  /^(Ctrl|Shift|Alt|Cmd|Esc|esc|F\d|\?|↑|↓|↵|[A-Z]-[A-Z]|\d+%?|[A-Z0-9-]+|v[\d.]+|Rackula|KVM|HDMI|SFP|PoE|YAML|ZIP|PNG|JPEG|PDF|SVG|JSON|CSV|NetBox|GitHub|MIT|LED|PDU|UPS|SNMP|MQTT|Modbus|Docker|Svelte|Three\.js|APC|Cisco|Dell|HPE|MikroTik|Synology|Ubiquiti)$/;

const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 950 } });
page.setDefaultTimeout(8000);
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`[console.error] ${m.text()}`);
});

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

/** 读取当前可见的气泡文本（bits-ui Tooltip） */
async function readBubble() {
  return page.evaluate(() => {
    const c =
      document.querySelector(".tooltip-content") ||
      document.querySelector('[role="tooltip"]');
    return c ? (c.innerText || c.textContent || "").replace(/\s+/g, " ").trim() : null;
  });
}

/** 把「含英文的片段」挑出来（白名单外），用于判断是否漏翻 */
function englishLeftovers(texts) {
  const out = [];
  for (const raw of texts) {
    const t = String(raw).replace(/\s+/g, " ").trim();
    if (!t) continue;
    if (!/[A-Za-z]/.test(t)) continue;
    if (HAS_CJK.test(t)) {
      // 中英混合：把英文词摘出来逐个过白名单
      const words = t.match(/[A-Za-z][A-Za-z.'/-]*/g) ?? [];
      const bad = words.filter((w) => !ALLOW_EN.test(w));
      if (bad.length) out.push(`${t}  ← ${bad.join(",")}`);
      continue;
    }
    if (!ALLOW_EN.test(t)) out.push(t);
  }
  return out;
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

  // ---------------- H1. 撤销气泡（历史描述整串中文化） ----------------
  await page.locator('[data-testid="sidebar-tab-racks"]').click();
  await page.waitForTimeout(700);
  await page.locator('[data-testid="rack-item-rack-1"]').click();
  await page.waitForTimeout(600);
  await page.keyboard.press("Control+d"); // 复制机柜 → 历史描述 `Duplicate rack "机柜 A"`
  await page.waitForTimeout(900);
  // 复制机柜的成功提示（toast 3s 后自动消失，先抢读）
  results.toastsAfterDuplicateRack = await page
    .locator(".toast__message")
    .allInnerTexts()
    .catch(() => []);
  checks.H6_duplicateToastChinese =
    results.toastsAfterDuplicateRack.length > 0 &&
    results.toastsAfterDuplicateRack.some((t) => /机柜已复制/.test(t)) &&
    results.toastsAfterDuplicateRack.every((t) => HAS_CJK.test(t));
  await page.waitForTimeout(700);

  const undoEl = page.locator('[data-testid="btn-undo"]').first();
  await undoEl.hover({ force: true, timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(700);
  results.undoBubble = await readBubble();
  await page.mouse.move(5, 5);
  await page.waitForTimeout(300);

  results.undoBubbleLeftovers = englishLeftovers([
    (results.undoBubble ?? "").replace(/(Ctrl|Shift|Cmd|Alt)\s*\+\s*[A-Za-z]/g, ""),
  ]);
  checks.H1_undoBubbleChinese =
    !!results.undoBubble &&
    HAS_CJK.test(results.undoBubble) &&
    results.undoBubbleLeftovers.length === 0 &&
    /撤销/.test(results.undoBubble);

  // ---------------- H9. 历史操作提示（Undid: <描述>） ----------------
  // 必须紧跟复制动作做：此时活动标签页仍是原布局，撤销栈里有内容；
  // 后面切到布局库复制会 openTab 到新布局，新标签页的撤销栈是空的。
  const beforeUndo = await page
    .locator(".toast__message")
    .allInnerTexts()
    .catch(() => []);
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(1200);
  const toastsAfterUndo = await page
    .locator(".toast__message")
    .allInnerTexts()
    .catch(() => []);
  results.freshToastsAfterUndo = toastsAfterUndo.filter(
    (t) => !beforeUndo.includes(t),
  );
  results.undoToastLeftovers = englishLeftovers(
    results.freshToastsAfterUndo.map((t) =>
      t.replace(/(Ctrl|Shift|Cmd|Alt)\s*\+\s*[A-Za-z]/g, ""),
    ),
  );
  checks.H9_undoToastChinese =
    results.freshToastsAfterUndo.length > 0 &&
    results.freshToastsAfterUndo.every(
      (t) => HAS_CJK.test(t) && /已撤销/.test(t),
    ) &&
    results.undoToastLeftovers.length === 0;

  // ---------------- H2. 关于 / 快捷键面板 ----------------
  await openPalette();
  await page
    .locator('[data-testid="command-palette-item-show-help"]')
    .click({ timeout: 6000 })
    .catch(async () => {
      await page.keyboard.type("about");
      await page.waitForTimeout(500);
      await page
        .locator('[data-testid="command-palette-item-show-help"]')
        .click({ timeout: 6000 });
    });
  await page.waitForTimeout(1500);

  results.helpGroups = await page
    .locator(".shortcut-group h4")
    .allInnerTexts()
    .catch(() => []);
  results.helpActions = await page
    .locator(".shortcut-row .action")
    .allInnerTexts()
    .catch(() => []);
  results.helpQuickLinks = await page
    .locator(".quick-link")
    .allInnerTexts()
    .catch(() => []);
  results.helpCopyButton = await page
    .locator(".copy-info-btn")
    .innerText()
    .catch(() => "");
  results.helpMadeIn = await page
    .locator(".made-in")
    .innerText()
    .catch(() => "");
  results.helpInfoLabels = await page
    .locator(".info-label")
    .allInnerTexts()
    .catch(() => []);

  const helpAll = [
    ...results.helpGroups,
    ...results.helpActions,
    ...results.helpQuickLinks,
    results.helpCopyButton,
    results.helpInfoLabels.join(" "),
  ];
  results.helpLeftovers = englishLeftovers(helpAll);
  checks.H2_helpChinese =
    results.helpGroups.length > 0 &&
    results.helpGroups.every((g) => HAS_CJK.test(g)) &&
    results.helpActions.every((a) => HAS_CJK.test(a)) &&
    HAS_CJK.test(results.helpCopyButton) &&
    HAS_CJK.test(results.helpMadeIn) &&
    results.helpLeftovers.length === 0;

  await page.keyboard.press("Escape");
  await page.waitForTimeout(700);

  // ---------------- H3. 设置弹窗 ----------------
  await openPalette();
  await page.locator('[data-testid="command-palette-settings"]').click();
  await page.waitForSelector('[data-testid="settings-dialog"]', { timeout: 8000 });
  await page.waitForTimeout(600);

  results.settingsSectionTitles = await page
    .locator(".settings-section-title")
    .allInnerTexts()
    .catch(() => []);
  results.settingsActionLabels = await page
    .locator(".settings-action-label")
    .allInnerTexts()
    .catch(() => []);
  results.settingsActionHelps = await page
    .locator(".settings-action-help")
    .allInnerTexts()
    .catch(() => []);
  results.settingsButtons = await page
    .locator(".settings-action-row button")
    .allInnerTexts()
    .catch(() => []);
  results.settingsLeftovers = englishLeftovers([
    ...results.settingsSectionTitles,
    ...results.settingsActionLabels,
    ...results.settingsActionHelps,
    ...results.settingsButtons,
  ]);
  checks.H3_settingsChinese = results.settingsLeftovers.length === 0;

  await page.keyboard.press("Escape");
  await page.waitForTimeout(700);

  // ---------------- H4. 设备库分组切换 ----------------
  await page.locator('[data-testid="sidebar-tab-devices"]').click();
  await page.waitForTimeout(1200);
  results.groupingSegments = await page
    .locator(".grouping-toggle .segment")
    .allInnerTexts()
    .catch(() => []);
  checks.H4_groupingChinese =
    results.groupingSegments.length >= 2 &&
    results.groupingSegments.some((s) => /品牌/.test(s)) &&
    results.groupingSegments.some((s) => /类别/.test(s));

  // ---------------- H5. 布局库复制命名 ----------------
  await page.locator('[data-testid="sidebar-tab-layouts"]').click();
  await page.waitForTimeout(1200);
  const firstRow = page.locator('[data-testid^="layout-item-"]').first();
  if ((await firstRow.count()) > 0) {
    await firstRow.click({ button: "right", force: true });
    await page.waitForTimeout(700);
    const dup = page
      .locator('[data-testid="ctx-menu-item"]')
      .filter({ hasText: /复制|Duplicate/ })
      .first();
    if ((await dup.count()) > 0) {
      await dup.click({ force: true });
      await page.waitForTimeout(2500);
    } else {
      notes.push("ctx-menu 未出现「复制」项（locator 未命中）");
    }
  } else {
    notes.push("布局库没有行（layout-item 未命中）");
  }
  results.layoutNames = await page
    .locator(".layout-name")
    .allInnerTexts()
    .catch(() => []);
  results.toasts = await page
    .locator(".toast__message")
    .allInnerTexts()
    .catch(() => []);
  results.duplicatedLayoutName =
    results.layoutNames.find((n) => /副本|Copy/.test(n)) ?? "";
  checks.H5_layoutDuplicateSuffix =
    /副本$/.test(results.duplicatedLayoutName) &&
    results.toasts.some((t) => /已复制为/.test(t));

  // ---------------- H7. 存储状态标识（Browser → 浏览器） ----------------
  await page.locator('[data-testid="sidebar-tab-racks"]').click();
  await page.waitForTimeout(600);
  results.storageChipLoc = await page
    .locator(".storage-chip-loc")
    .first()
    .innerText()
    .catch(() => "");
  checks.H7_storageChipChinese =
    !results.storageChipLoc || HAS_CJK.test(results.storageChipLoc);
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
writeFileSync("tools/_v12.json", JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify(report, null, 2));
console.log(
  failed.length === 0
    ? "=== SUMMARY === ALL PASS"
    : `=== SUMMARY === ${failed.length} FAILED`,
);
