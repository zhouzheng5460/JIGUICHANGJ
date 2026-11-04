/**
 * Rack3D 第六轮改动专项验证
 * =================================================================================
 * 覆盖断言：
 *   V. 默认 / 复位取景**不计入**机柜以外摆放的三维模型：
 *      在远处放一个场景元素后 `resetView()`，取景半高必须与"没有元素时"逐位相等。
 *   W. 弹窗**不溢出** 3D 视窗、不遮挡标题与按钮：
 *      实测弹窗 rect 必须完整落在 `.rack3d-viewport` 内（顶部设备 → 翻转/夹取场景也测）。
 *   X. 地面网格线不透明度 30%，且**地面色 == 背景色**（黑 / 白两套主题都验）。
 *   Y. 聚焦机柜内设备时，设备包围盒宽度约占屏幕宽度 **70%**。
 *
 * 用法：node tools/e2e.mjs tools/rack3d-verify-v6.mjs
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
const LAYOUT_ID = "rack3d-demo-0000-4000-8000-000000000003";

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

// 12U 满配：让弹窗内容尽量长，最容易触发"顶出视口"
const RACK_1_DEVICES = [
  placed("dev-firewall", "1u-router-firewall", "边界防火墙", 12),
  placed("dev-switch", "24-port-switch", "核心交换机", 11),
  placed("dev-server-1", "1u-server", "应用服务器", 9),
  placed("dev-nas", "4u-storage", "NAS 存储", 4),
  placed("dev-ups", "2u-ups", "UPS 电源", 2),
];

const layout = {
  version: "26.9.0",
  name: "Rack3D 取景与弹窗验证",
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
  metadata: { id: LAYOUT_ID, name: "Rack3D 取景与弹窗验证", schema_version: "1.1" },
};

const ALL_8 = [
  "power_w",
  "current_a",
  "voltage_v",
  "temp_c",
  "humidity",
  "status",
  "rpm",
  "on_off",
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

async function engineState() {
  return page.evaluate(() => {
    const c = window.__rack3d;
    if (!c) return null;
    const gridMats = Array.isArray(c.grid?.material)
      ? c.grid.material
      : [c.grid?.material];
    return {
      orthoTop: c.orthoCamera.top,
      theme: c.theme,
      background: c.renderer?.getClearColor?.(new c.racks[0].frameMaterials[0].color.constructor())
        ?.getHexString?.() ?? null,
      floorColour: c.floor?.material?.color?.getHexString() ?? null,
      gridOpacity: gridMats?.[0]?.opacity ?? null,
      gridTransparent: gridMats?.[0]?.transparent ?? null,
      propCount: c.propGroup?.children?.length ?? 0,
      selectedDevice: c.selectedDeviceId ?? null,
    };
  });
}

async function clickReset() {
  await page.evaluate(() => {
    document.querySelectorAll(".foot-btn").forEach((b) => {
      if (b.textContent?.trim() === "重置视角") b.click();
    });
  });
  await page.waitForTimeout(1700);
}

/** 设备（或任意 object）投影到屏幕后的横向占比 */
async function screenWidthPct(deviceId) {
  return page.evaluate((id) => {
    const c = window.__rack3d;
    const canvas = document.querySelector(".rack3d-viewport canvas");
    const mesh = c.deviceMeshes.get(id);
    if (!c || !canvas || !mesh) return null;
    const rect = canvas.getBoundingClientRect();
    const Box3 = c.sceneBox().constructor;
    const box = new Box3().setFromObject(mesh);
    let minX = Infinity;
    let maxX = -Infinity;
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          const v = box.min.clone().set(x, y, z).project(c.camera);
          const px = (v.x * 0.5 + 0.5) * rect.width;
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
        }
      }
    }
    return {
      viewportW: Math.round(rect.width),
      px: +(maxX - minX).toFixed(1),
      pct: +((maxX - minX) / rect.width).toFixed(4),
    };
  }, deviceId);
}

/** 弹窗是否完整落在 3D 视窗内 */
async function popupContainment(selector) {
  return page.evaluate((sel) => {
    const popup = document.querySelector(sel);
    const vp = document.querySelector(".rack3d-viewport");
    if (!popup || !vp) return null;
    const p = popup.getBoundingClientRect();
    const v = vp.getBoundingClientRect();
    const head = document.querySelector(".rack3d-head")?.getBoundingClientRect();
    const foot = document.querySelector(".rack3d-foot")?.getBoundingClientRect();
    const overlaps = (a, b) =>
      !!b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    return {
      popup: {
        top: +p.top.toFixed(1),
        bottom: +p.bottom.toFixed(1),
        left: +p.left.toFixed(1),
        right: +p.right.toFixed(1),
        w: Math.round(p.width),
        h: Math.round(p.height),
      },
      viewport: {
        top: +v.top.toFixed(1),
        bottom: +v.bottom.toFixed(1),
        left: +v.left.toFixed(1),
        right: +v.right.toFixed(1),
        w: Math.round(v.width),
        h: Math.round(v.height),
      },
      insideViewport:
        p.top >= v.top - 1 &&
        p.bottom <= v.bottom + 1 &&
        p.left >= v.left - 1 &&
        p.right <= v.right + 1,
      overlapsHead: overlaps(p, head),
      overlapsFoot: overlaps(p, foot),
      scrollable: popup.scrollHeight > popup.clientHeight + 1,
    };
  }, selector);
}

async function scanPoint(predicateSrc) {
  return page.evaluate((src) => {
    const c = window.__rack3d;
    const canvas = document.querySelector(".rack3d-viewport canvas");
    if (!c || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    // eslint-disable-next-line no-new-func
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

  // ---------------- X. 网格线 30% + 地面 == 背景 ----------------
  const dark = await engineState();
  const darkBg = await page.evaluate(() => {
    const c = window.__rack3d;
    const col = new c.racks[0].frameMaterials[0].color.constructor();
    c.renderer.getClearColor(col);
    return col.getHexString();
  });
  results.darkGround = {
    background: darkBg,
    floor: dark?.floorColour ?? null,
    gridOpacity: dark?.gridOpacity ?? null,
    gridTransparent: dark?.gridTransparent ?? null,
  };

  // 亮色主题
  await page.evaluate(() => {
    document.querySelectorAll(".rack3d-tools .seg-btn").forEach((b) => {
      if (b.textContent?.trim() === "亮色") b.click();
    });
  });
  await page.waitForTimeout(1500);
  const light = await engineState();
  const lightBg = await page.evaluate(() => {
    const c = window.__rack3d;
    const col = new c.racks[0].frameMaterials[0].color.constructor();
    c.renderer.getClearColor(col);
    return col.getHexString();
  });
  results.lightGround = {
    background: lightBg,
    floor: light?.floorColour ?? null,
    gridOpacity: light?.gridOpacity ?? null,
  };
  await shot("v6-X-ground-light.png");
  await page.evaluate(() => {
    document.querySelectorAll(".rack3d-tools .seg-btn").forEach((b) => {
      if (b.textContent?.trim() === "暗色") b.click();
    });
  });
  await page.waitForTimeout(1400);

  // ---------------- V. 复位取景不计入场景元素 ----------------
  await clickReset();
  const noProp = await engineState();
  const topNoProp = noProp?.orthoTop ?? null;

  // 在很远处放一个场景元素（旧实现会把它并进 sceneBox，把相机推远）
  await page.evaluate(() => {
    window.__rack3d.setProps([
      { id: "probe-prop", kind: "cube", x: 6, z: 5, rotation: 0, colour: "#8be9fd" },
    ]);
  });
  await page.waitForTimeout(700);
  const withProp = await engineState();
  await clickReset();
  const afterResetWithProp = await engineState();
  await shot("v6-V-prop-reset.png");
  results.resetExcludesProps = {
    propCount: withProp?.propCount ?? null,
    topNoProp: topNoProp === null ? null : +topNoProp.toFixed(6),
    topWithProp:
      afterResetWithProp?.orthoTop == null
        ? null
        : +afterResetWithProp.orthoTop.toFixed(6),
    identical:
      topNoProp != null &&
      afterResetWithProp?.orthoTop != null &&
      Math.abs(afterResetWithProp.orthoTop - topNoProp) < 1e-6,
  };
  // 清掉元素
  await page.evaluate(() => window.__rack3d.setProps([]));
  await page.waitForTimeout(500);
  await clickReset();

  // ---------------- W. 弹窗不溢出视窗 ----------------
  // W1：中部设备（常规）
  const ptMid = await scanPoint(
    'pick && pick.device && pick.device.deviceId === "dev-server-1"',
  );
  let wMid = null;
  if (ptMid) {
    await page.mouse.click(ptMid.cx, ptMid.cy);
    await page.waitForTimeout(1800);
    wMid = await popupContainment('.device-popup[aria-label="设备实时数据"]');
  }
  await shot("v6-W1-popup-mid.png");

  // W2：最顶部设备（锚点贴近视窗上沿，最容易顶出去）
  await clickReset();
  const ptTop = await scanPoint(
    'pick && pick.device && pick.device.deviceId === "dev-firewall"',
  );
  let wTop = null;
  if (ptTop) {
    await page.mouse.click(ptTop.cx, ptTop.cy);
    await page.waitForTimeout(1800);
    wTop = await popupContainment('.device-popup[aria-label="设备实时数据"]');
  }
  await shot("v6-W2-popup-top.png");

  // W3：机柜弹窗。
  // ⚠️ 必须先用弹窗自带的关闭按钮把上一轮弹窗关掉：它浮在画布上层，
  // 盖住的区域里"点空白/点外壳"实际会点在弹窗上，永远切不到机柜弹窗。
  await page.evaluate(() => {
    document.querySelectorAll(".popup-close").forEach((b) => b.click());
  });
  await page.waitForTimeout(900);
  await clickReset();
  const ptEmptyW3 = await scanPoint("pick && pick.rackId === null");
  if (ptEmptyW3) {
    await page.mouse.click(ptEmptyW3.cx, ptEmptyW3.cy);
    await page.waitForTimeout(1200);
  }
  await clickReset();
  const ptShell = await scanPoint('pick && pick.rackId === "rack-1" && !pick.device');
  let wRack = null;
  if (ptShell) {
    await page.mouse.click(ptShell.cx, ptShell.cy);
    await page.waitForTimeout(1800);
    wRack = await popupContainment('.device-popup[aria-label="机柜数据"]');
  }
  await shot("v6-W3-popup-rack.png");
  results.popupContainment = {
    mid: wMid,
    top: wTop,
    rack: wRack,
    emptyPoint: ptEmptyW3,
    shellPoint: ptShell,
    popupsInDom: await page.evaluate(() =>
      [...document.querySelectorAll(".device-popup")].map((n) =>
        n.getAttribute("aria-label"),
      ),
    ),
  };

  // ---------------- Y. 设备聚焦 70% ----------------
  await clickReset();
  await page.evaluate(() => window.__rack3d.focusDevice("dev-server-1"));
  await page.waitForTimeout(1800);
  const fill = await screenWidthPct("dev-server-1");
  results.deviceFill = fill;
  await shot("v6-Y-device-fill.png");
  notes.push(
    "V/W/X/Y: " +
      JSON.stringify({
        v: results.resetExcludesProps,
        w: results.popupContainment,
        x: { dark: results.darkGround, light: results.lightGround },
        y: results.deviceFill,
      }),
  );
} catch (e) {
  notes.push("FATAL: " + e.message + "\n" + e.stack);
} finally {
  await browser.close();
}

const v = results.resetExcludesProps;
const w = results.popupContainment;
const x = { dark: results.darkGround, light: results.lightGround };
const y = results.deviceFill;

const checks = {
  // V：远处放了场景元素后复位，取景与"没放元素时"完全一致
  V_resetIgnoresProps: v?.propCount === 1 && v?.identical === true,
  // W：三种场景的弹窗都完整落在 3D 视窗内，且不压到标题栏 / 底部按钮
  W1_midInside:
    w?.mid?.insideViewport === true &&
    w?.mid?.overlapsHead === false &&
    w?.mid?.overlapsFoot === false,
  W2_topInside:
    w?.top?.insideViewport === true &&
    w?.top?.overlapsHead === false &&
    w?.top?.overlapsFoot === false,
  W3_rackInside:
    w?.rack?.insideViewport === true &&
    w?.rack?.overlapsHead === false &&
    w?.rack?.overlapsFoot === false,
  // X：网格 30% 半透明；两套主题下地面色都等于背景色
  X1_gridOpacity30:
    x?.dark?.gridOpacity === 0.3 &&
    x?.dark?.gridTransparent === true &&
    x?.light?.gridOpacity === 0.3,
  // 地色 == 背景色，且两套主题用的是指定色值（暗 #21222C / 亮 #E9E9E9）
  X2_floorEqualsBackground:
    x?.dark?.floor != null &&
    x?.dark?.floor === x?.dark?.background &&
    x?.light?.floor != null &&
    x?.light?.floor === x?.light?.background,
  X3_exactColours:
    x?.dark?.floor === "191a21" && x?.light?.floor === "e9e9e9",
  // Y：设备聚焦时包围盒宽度约占屏幕 70%（±6 个百分点）
  Y_deviceFill70:
    y?.pct != null && y.pct >= 0.64 && y.pct <= 0.76,
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
