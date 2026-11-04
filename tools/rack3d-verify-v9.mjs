/**
 * Rack3D 第十六轮改动专项验证（Round 16）
 * =================================================================================
 * 覆盖断言：
 *   R16-4. 数据页「已绑定资产」只显示当前布局的内容：注入一个属于其它布局的
 *           绑定（rack-foreign），断言它不出现在数据页（计数与卡片数均为当前布局值）。
 *   R16-5. 2D 设备图元右下角状态点：已绑定即显示醒目绿色（rgb(61,220,132)），
 *           不出现灰色（idle 旧逻辑）。
 *   R16-6. 选中画布设备后，右侧属性页签保持用户当前选中的「数据」页签，不被强制切回编辑。
 *
 * 用法：node tools/e2e.mjs tools/rack3d-verify-v9.mjs
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
const LAYOUT_ID = "rack3d-demo-0000-4000-8000-000000000016";

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
  name: "Rack3D Round16 验证",
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
  metadata: { id: LAYOUT_ID, name: "Rack3D Round16 验证", schema_version: "1.1" },
};

const ALL_8 = [
  "power_w", "current_a", "voltage_v", "temp_c",
  "humidity", "status", "rpm", "on_off",
];

// 当前布局内的绑定：1 个柜级 + 4 个设备级 = 5 条
const currentBindings = [
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

// 额外注入一条「不属于当前布局」的绑定，用于验证数据页只显示当前布局内容
const foreignBinding = {
  id: "bind-rack-foreign",
  asset_kind: "rack",
  asset_id: "rack-foreign",
  label: "外来机柜（其它布局）",
  adapter: "mock",
  endpoint: "mock://local",
  metrics: ALL_8,
  point_map: {},
  thresholds: {},
  poll_ms: 1200,
};

const bindings = [...currentBindings, foreignBinding];
const GLOBAL_BINDING_COUNT = bindings.length; // 6

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

  // ---------------- R16-5. 画布状态点应为绿色（已绑定 = 醒目绿，非灰） ----------------
  const dot = await page.evaluate(() => {
    const d = document.querySelector(".binding-badge .binding-dot");
    if (!d) return null;
    const cs = getComputedStyle(d);
    const cls = [...d.classList].find((c) => c !== "binding-dot") ?? null;
    return { fill: cs.fill, cls };
  });
  results.dot = dot;

  // ---------------- R16-4. 数据页只显示当前布局的绑定 ----------------
  await page
    .evaluate(() => {
      document
        .querySelector('[data-testid="side-panel-tab-telemetry"]')
        ?.click();
    });
  await page.waitForTimeout(1500);
  const dataPage = await page.evaluate(() => {
    const meta = document.querySelector(".meta-text")?.textContent?.trim() ?? "";
    const cards = document.querySelectorAll(".binding-card").length;
    const stored = JSON.parse(
      localStorage.getItem("rack3d_telemetry_bindings") || "[]",
    ).length;
    const names = [
      ...document.querySelectorAll(".rack-group-name"),
    ].map((n) => n.textContent?.trim() ?? "");
    return { meta, cards, stored, names };
  });
  results.dataPage = dataPage;

  // ---------------- R16-6. 选中画布设备后保持「数据」页签不被强制切回编辑 ----------------
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
    dev.dispatchEvent(new PointerEvent("pointerdown", opts));
    dev.dispatchEvent(new PointerEvent("pointerup", opts));
    return true;
  });
  await page.waitForTimeout(1500);
  const tabState = await page.evaluate(() => {
    const tele = document.querySelector(
      '[data-testid="side-panel-tab-telemetry"]',
    );
    const edit = document.querySelector('[data-testid="side-panel-tab-edit"]');
    return {
      telemetryActive: tele?.getAttribute("data-state") === "active",
      editActive: edit?.getAttribute("data-state") === "active",
    };
  });
  results.tabState = { clicked, ...tabState };
} catch (e) {
  notes.push("FATAL: " + e.message + "\n" + e.stack);
} finally {
  await browser.close();
}

const dot = results.dot;
const dp = results.dataPage;
const ts = results.tabState;

const checks = {
  // R16-5：已绑定状态点为绿色（rgb(61,220,132) = #3ddc84），且类名不是 idle/error
  R16_5_greenBindingDot:
    !!dot &&
    dot.cls === "live" &&
    dot.fill.replace(/\s/g, "") === "rgb(61,220,132)",
  // R16-4：全局 6 条绑定里只有 5 条属于当前布局，数据页应只显示这 5 条
  R16_4_currentLayoutOnly:
    !!dp &&
    dp.stored === 6 &&
    dp.cards === 5 &&
    /5/.test(dp.meta) &&
    dp.names.length === 1 &&
    dp.names[0].includes("机柜 A"),
  // R16-6：选中设备后「数据」页签仍激活，「编辑」页签未激活
  R16_6_tabPreserved:
    !!ts &&
    ts.clicked === true &&
    ts.telemetryActive === true &&
    ts.editActive === false,
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
