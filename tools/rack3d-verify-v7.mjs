/**
 * Rack3D 第七轮改动专项验证（Round E）
 * =================================================================================
 * 覆盖断言：
 *   A1. 线框蓝色线框透明度 = 50% 且 transparent=true
 *   A2. 线框混合模式 = AdditiveBlending（three.js 枚举值 2，即「叠加」）
 *   B1. 地面材质 = MeshBasicMaterial（无光，不接受光照影响，isMeshBasicMaterial=true）
 *   C1. 每台机柜顶部都有常驻名称标签 Sprite，且初始可见
 *   C2. 选中机柜并弹出其弹窗时，该机柜的标签被隐藏（labelSprite.visible === false）
 *   C3. 关闭机柜弹窗后，该机柜标签恢复可见
 *
 * 用法：node tools/e2e.mjs tools/rack3d-verify-v7.mjs
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
const LAYOUT_ID = "rack3d-demo-0000-4000-8000-000000000007";

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
  placed("dev-ups", "2u-ups", "UPS 电源", 2),
];

const layout = {
  version: "26.9.0",
  name: "Rack3D 线框/地面/标签验证",
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
  metadata: { id: LAYOUT_ID, name: "Rack3D 线框/地面/标签验证", schema_version: "1.1" },
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

async function shot(name) {
  try {
    await page.screenshot({ path: join(OUT, name) });
  } catch (e) {
    notes.push(`shot FAIL ${name}: ${e.message}`);
  }
}

async function clickReset() {
  await page.evaluate(() => {
    document.querySelectorAll(".foot-btn").forEach((b) => {
      if (b.textContent?.trim() === "重置视角") b.click();
    });
  });
  await page.waitForTimeout(1700);
}

async function scanPoint(predicateSrc) {
  return page.evaluate((src) => {
    const c = window.__rack3d;
    const canvas = document.querySelector(".rack3d-viewport canvas");
    if (!c || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const test = new Function("pick", `return (${src});`);
    for (let gy = 0.05; gy <= 0.95; gy += 0.012) {
      for (let gx = 0.03; gx <= 0.97; gx += 0.008) {
        const cx = rect.left + rect.width * gx;
        const cy = rect.top + rect.height * gy;
        let info = null;
        try {
          info = c.debugProbe(cx, cy);
        } catch {
          info = null;
        }
        if (!info) continue;
        if (test(info.pick)) {
          return { gx: +gx.toFixed(4), gy: +gy.toFixed(4), cx, cy, pick: info.pick };
        }
      }
    }
    return null;
  }, predicateSrc);
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
      localStorage.removeItem("rack3d_scene_props");
      localStorage.removeItem("rack3d_scene_theme");
    },
    { layoutId: LAYOUT_ID, layout, bindings },
  );

  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(7000);
  await page.locator(".rack3d-launcher").first().click({ timeout: 8000 });
  await page.waitForTimeout(5000);

  // ---------------- A/B/C1. 初始状态读取 ----------------
  const init = await page.evaluate(() => {
    const c = window.__rack3d;
    const rack1 = c.racks.find((r) => r.id === "rack-1");
    const wire = rack1?.wireMaterials?.[0];
    const label = rack1?.labelSprite;
    return {
      wireOpacity: wire?.opacity ?? null,
      wireTransparent: wire?.transparent ?? null,
      wireBlending: wire?.blending ?? null,
      floorIsBasic: c.floor?.material?.isMeshBasicMaterial === true,
      floorType: c.floor?.material?.type ?? null,
      labelExists: !!label,
      labelIsSprite: label?.isSprite === true,
      labelVisibleInit: label?.visible ?? null,
    };
  });
  results.init = init;
  await shot("v7-init-wire-floor-label.png");

  // ---------------- C2. 选中机柜并弹窗 → 标签隐藏 ----------------
  // 先关掉可能存在的其它弹窗
  await page.evaluate(() => {
    document.querySelectorAll(".popup-close").forEach((b) => b.click());
  });
  await page.waitForTimeout(900);
  await clickReset();
  const ptShell = await scanPoint('pick && pick.rackId === "rack-1" && !pick.device');
  let labelHiddenOnPopup = null;
  if (ptShell) {
    await page.mouse.click(ptShell.cx, ptShell.cy);
    await page.waitForTimeout(1800);
    labelHiddenOnPopup = await page.evaluate(() => {
      const c = window.__rack3d;
      const rack1 = c.racks.find((r) => r.id === "rack-1");
      const popupOpen = !!document.querySelector('.device-popup[aria-label="机柜数据"]');
      return {
        popupOpen,
        labelVisible: rack1?.labelSprite?.visible ?? null,
      };
    });
  }
  results.labelHiddenOnPopup = labelHiddenOnPopup;
  await shot("v7-C2-rack-selected-label-hidden.png");

  // ---------------- C3. 关闭弹窗 → 标签恢复 ----------------
  await page.evaluate(() => {
    document.querySelectorAll(".popup-close").forEach((b) => b.click());
  });
  await page.waitForTimeout(1800);
  const labelShownAfterClose = await page.evaluate(() => {
    const c = window.__rack3d;
    const rack1 = c.racks.find((r) => r.id === "rack-1");
    return { labelVisible: rack1?.labelSprite?.visible ?? null };
  });
  results.labelShownAfterClose = labelShownAfterClose;
  await shot("v7-C3-rack-closed-label-shown.png");

  notes.push(
    "A/B/C: " +
      JSON.stringify({ init, labelHiddenOnPopup, labelShownAfterClose }),
  );
} catch (e) {
  notes.push("FATAL: " + e.message + "\n" + e.stack);
} finally {
  await browser.close();
}

const i = results.init;
const h = results.labelHiddenOnPopup;
const s = results.labelShownAfterClose;

const checks = {
  // A1：线框透明度 50% + 半透明
  A1_wireOpacity50:
    i?.wireOpacity === 0.5 && i?.wireTransparent === true,
  // A2：叠加混合（AdditiveBlending = 2）
  A2_wireAdditive: i?.wireBlending === 2,
  // B1：地面无光材质
  B1_floorBasic: i?.floorIsBasic === true,
  // C1：标签存在且初始可见
  C1_labelExistsAndVisible:
    i?.labelExists === true &&
    i?.labelIsSprite === true &&
    i?.labelVisibleInit === true,
  // C2：选中并弹窗时标签隐藏
  C2_labelHiddenOnPopup:
    h?.popupOpen === true && h?.labelVisible === false,
  // C3：关闭弹窗后标签恢复
  C3_labelShownAfterClose: s?.labelVisible === true,
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
