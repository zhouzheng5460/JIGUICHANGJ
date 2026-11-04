/**
 * Rack3D 第十五轮改动专项验证（Round 15）
 * =================================================================================
 * 覆盖断言：
 *   R15-4. 2D 设备图元右下角出现数据绑定状态指示灯（已绑定设备有 .binding-badge）
 *   R15-5. 布局库计数本地化（"N Layouts" → "N 个布局"；元信息 "机柜 · 设备" 译出）
 *   R15-6. 已绑定资产按机柜一级分组（.rack-group），组内为设备绑定卡；
 *          选中画布设备后列表按该设备交互式过滤（出现过滤提示）
 *
 * 用法：node tools/e2e.mjs tools/rack3d-verify-v8.mjs
 */

import { chromium } from "playwright-core";
import * as YAMLNS from "yaml";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const EDGE_PATHS = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const URL = process.env.RACK3D_URL ?? "http://localhost:5173/";
const OUT = process.env.RACK3D_OUT ?? process.cwd();
const UNITS_PER_U = 6;
const LAYOUT_ID = "rack3d-demo-0000-4000-8000-000000000015";

const YAML = YAMLNS.default ?? YAMLNS;
const parseYaml = YAML.parse ?? YAMLNS.parse;
const template = parseYaml(
  readFileSync("static/templates/home-lab.rackula.yaml", "utf8"),
);

const placed = (id, slug, name, uPos, face = "front") => ({
  id,
  device_type: slug,
  name,
  position: uPos * UNITS_PER_U,
  face,
});

const RACK_1_DEVICES = [
  placed("dev-firewall", "1u-router-firewall", "边界防火墙", 12),
  placed("dev-switch", "24-port-switch", "核心交换机", 11),
  placed("dev-server-1", "1u-server", "应用服务器", 9),
  placed("dev-nas", "4u-storage", "NAS 存储", 4),
];

const layout = {
  version: "26.9.0",
  name: "Rack3D Round15 验证",
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
      devices: RACK_1_DEVICES,
    },
  ],
  device_types: template.device_types,
  settings: template.settings,
  metadata: { id: LAYOUT_ID, name: "Rack3D Round15 验证", schema_version: "1.1" },
};

const ALL_8 = [
  "power_w", "current_a", "voltage_v", "temp_c",
  "humidity", "status", "rpm", "on_off",
];
const bindings = [
  {
    id: "bind-rack-1",
    asset_kind: "rack",
    asset_id: "rack-1",
    label: "机柜 A 柜级采集",
    adapter: "mock",
    endpoint: "mock://local",
    metrics: ALL_8,
    point_map: {},
    thresholds: {},
    poll_ms: 1200,
  },
  ...RACK_1_DEVICES.map((d) => ({
    id: `bind-${d.id}`,
    asset_kind: "device",
    asset_id: d.id,
    label: d.name,
    adapter: "mock",
    endpoint: "mock://local",
    metrics: ALL_8,
    point_map: {},
    thresholds: {},
    poll_ms: 1200,
  })),
];

const executablePath = EDGE_PATHS.find((p) => existsSync(p));
if (!executablePath) {
  console.error("找不到 msedge.exe");
  process.exit(2);
}

const notes = [];
const results = {};
const errors = [];
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 950 } });
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`[console.error] ${m.text()}`);
});

async function clickTabByText(text) {
  return page.evaluate((t) => {
    const els = [
      ...document.querySelectorAll(
        'button, [role="tab"], .sidebar-tab, .tab-trigger, .tab',
      ),
    ];
    const el = els.find((e) => {
      const txt = (e.textContent || "").trim();
      return txt === t || txt.includes(t);
    });
    if (el) {
      el.click();
      return true;
    }
    return false;
  }, text);
}

try {
  await page.addInitScript(
    ({ layoutId, layout, bindings }) => {
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
      localStorage.setItem("rack3d_telemetry_bindings", JSON.stringify(bindings));
      localStorage.setItem("rack3d_locale", "zh-CN");
      localStorage.removeItem("rack3d_scene_props");
      localStorage.removeItem("rack3d_scene_theme");
    },
    { layoutId: LAYOUT_ID, layout, bindings },
  );

  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(7000);
  await page.locator(".rack3d-launcher").first().click({ timeout: 8000 });
  await page.waitForTimeout(5000);

  // ---------------- R15-4. 2D 设备图元绑定状态指示灯 ----------------
  const badge = await page.evaluate(() => {
    const devices = [...document.querySelectorAll(".rack-device")];
    const withBadge = devices.filter((d) =>
      d.querySelector(".binding-badge"),
    ).length;
    const dot = document.querySelector(".binding-badge .binding-dot");
    const stateClass = dot
      ? [...dot.classList].find((c) => c !== "binding-dot") ?? null
      : null;
    return {
      deviceCount: devices.length,
      withBadge,
      hasDot: !!dot,
      stateClass,
    };
  });
  results.badge = badge;

  // ---------------- R15-6. 已绑定资产按机柜分组 ----------------
  await clickTabByText("数据");
  await page.waitForTimeout(1500);
  const grouping = await page.evaluate(() => {
    const groups = [...document.querySelectorAll(".rack-group")];
    const first = groups[0];
    const cardsInFirst = first
      ? first.querySelectorAll(".binding-card").length
      : 0;
    const groupNames = groups.map(
      (g) => g.querySelector(".rack-group-name")?.textContent?.trim() ?? "",
    );
    return {
      groupCount: groups.length,
      cardsInFirst,
      groupNames,
    };
  });
  results.grouping = grouping;

  // ---------------- R15-6. 选中画布设备 → 交互式过滤 ----------------
  // 点击 2D 画布中某个设备图元，触发 selection，进而过滤已绑定资产列表
  const clicked = await page.evaluate(() => {
    const dev = document.querySelector(
      '.rack-device[data-device-uuid="dev-server-1"] .device-rect',
    ) || document.querySelector(".rack-device .device-rect");
    if (!dev) return false;
    const r = dev.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const opts = {
      bubbles: true,
      cancelable: true,
      clientX: cx,
      clientY: cy,
      pointerId: 1,
      isPrimary: true,
      pointerType: "mouse",
      button: 0,
    };
    // 设备选中依赖 pointerup 触发 onselect（非 click），且监听挂在 .device-rect 上
    dev.dispatchEvent(new PointerEvent("pointerdown", opts));
    dev.dispatchEvent(new PointerEvent("pointerup", opts));
    return true;
  });
  await page.waitForTimeout(1500);
  const filter = await page.evaluate(() => {
    const hint = document.querySelector(".linked-hint");
    const showAll = [
      ...document.querySelectorAll("button")].find(
      (b) => (b.textContent || "").includes("显示全部"),
    );
    const groups = [...document.querySelectorAll(".rack-group")];
    const visibleCards = groups.reduce(
      (n, g) => n + g.querySelectorAll(".binding-card").length,
      0,
    );
    return {
      clicked: true,
      hintText: hint?.textContent?.trim() ?? null,
      hasShowAll: !!showAll,
      visibleGroups: groups.length,
      visibleCards,
    };
  });
  filter.clicked = clicked;
  results.filter = filter;

  // ---------------- R15-5. 布局库计数本地化 ----------------
  await clickTabByText("布局");
  await page.waitForTimeout(1500);
  const layoutLoc = await page.evaluate(() => {
    const count = document.querySelector(".layout-count");
    const state = document.querySelector(".layout-state");
    const meta = document.querySelector(".layout-meta");
    return {
      countText: count?.textContent?.trim() ?? null,
      stateText: state?.textContent?.trim() ?? null,
      metaText: meta?.textContent?.trim() ?? null,
    };
  });
  results.layoutLoc = layoutLoc;

  // ---------------- 回归锁：SidePanel 编辑/视图页签结构不被词典层拍平 ----------------
  // Round 15 回归：applyComposed 一度对含元素子节点的大容器做 textContent 整体替换，
  // 把 View/Edit 面板内的控件全部拍平成一串文本。此处断言控件结构仍在。
  await page.evaluate(() => {
    document.querySelector('[data-testid="side-panel-tab-view"]')?.click();
  });
  await page.waitForTimeout(800);
  const panelStructure = await page.evaluate(() => {
    const controls = document.querySelector(".view-controls");
    return {
      viewControlsPresent: !!controls,
      controlGroups: controls ? controls.querySelectorAll(".control-group").length : 0,
      controlButtons: controls ? controls.querySelectorAll("button").length : 0,
      controlHeadings: controls ? controls.querySelectorAll(".control-label").length : 0,
    };
  });
  results.panelStructure = panelStructure;

  await page.evaluate(() => {
    document.querySelector('[data-testid="side-panel-tab-edit"]')?.click();
  });
  await page.waitForTimeout(800);
  const editStructure = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="side-panel-panel-edit"]');
    return {
      editPanelPresent: !!panel,
      // 拍平后 panel 内几乎没有元素节点；正常时至少有表单/标题结构
      descendantCount: panel ? panel.querySelectorAll("*").length : 0,
    };
  });
  results.editStructure = editStructure;
} catch (e) {
  notes.push("FATAL: " + e.message + "\n" + e.stack);
} finally {
  await browser.close();
}

const b = results.badge;
const g = results.grouping;
const f = results.filter;
const l = results.layoutLoc;
const ps = results.panelStructure;
const es = results.editStructure;

const checks = {
  // R15-4：存在设备图元，且其中已绑定设备渲染了状态指示灯
  R15_4_bindingBadge:
    !!b && b.deviceCount > 0 && b.withBadge > 0 && b.hasDot === true,
  // R15-6：按机柜一级分组，且组内含设备绑定卡
  R15_6_rackGrouping:
    !!g && g.groupCount >= 1 && g.cardsInFirst >= 1,
  // R15-6：选中画布设备后出现过滤提示与「显示全部」，且列表按该设备收窄
  R15_6_interactiveFilter:
    !!f &&
    f.clicked === true &&
    !!f.hintText &&
    f.hintText.length > 0 &&
    f.hasShowAll === true &&
    f.visibleCards >= 1 &&
    f.visibleCards < g.cardsInFirst,
  // R15-5：布局库计数本地化为「N 个布局」，状态/元信息译出
  R15_5_layoutCountLocalized:
    !!l &&
    !!l.countText &&
    l.countText.includes("个布局") &&
    !!l.metaText &&
    l.metaText.includes("个机柜") &&
    l.metaText.includes("台设备") &&
    (l.metaText.includes("使用中") ||
      l.metaText.includes("打开") ||
      l.metaText.includes("未打开")),
  // 回归锁：视图页签 3 个控件分组（显示模式分段按钮 + 标注开关 + 后视图）结构完整
  R15_7_viewPanelStructure:
    !!ps &&
    ps.viewControlsPresent === true &&
    ps.controlGroups === 3 &&
    ps.controlButtons >= 4 &&
    ps.controlHeadings >= 2,
  // 回归锁：编辑页签面板内仍是元素结构（未被 textContent 拍平成一串文本）
  R15_7_editPanelStructure:
    !!es && es.editPanelPresent === true && es.descendantCount >= 6,
};

const failed = Object.entries(checks)
  .filter(([, ok]) => !ok)
  .map(([k]) => k);

console.log("=== NOTES ===\n" + notes.join("\n"));
console.log("\n=== RESULTS ===\n" + JSON.stringify(results, null, 2));
console.log("\n=== CHECKS ===\n" + JSON.stringify(checks, null, 2));
console.log(
  "\n=== SUMMARY === " +
    (failed.length === 0 ? "ALL PASS" : `FAIL: ${failed.join(", ")}`),
);
console.log(
  "\n=== ERRORS (" + errors.length + ") ===\n" + errors.slice(0, 20).join("\n"),
);
