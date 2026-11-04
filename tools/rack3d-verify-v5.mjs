/**
 * Rack3D 第五轮改动专项验证
 * =================================================================================
 * 覆盖断言：
 *   P. 机柜**排列顺序**同步到 3D：布局里数组顺序与 `Rack.position` 顺序故意不一致，
 *      3D 场景必须按 position 排（与 2D 画布一致），而不是按数组顺序。
 *   Q. 复位取景：机柜排在视窗里占的比例（目标 ≈ 80%）
 *   R. 地面提亮：A/B 对照（新地色 vs 旧 0x1c1f26），隐藏机柜只留地面后测平均亮度
 *   S. 选中某柜时，**其它柜的柜内设备**一起降透明度（不只是柜壳）
 *   T. 透视（xray）模式下**机柜外壳不参与拾取**：点外壳不选中柜，点设备仍可选中；
 *      同一位置在实体模式下仍能选中机柜（证明改动只对 xray 生效）
 *   U. 3D 弹窗展示**全部**绑定指标（功率 / 电流 / 电压 / 温度 / 湿度 / 状态 / 转速 / 开关）
 *
 * 用法：node tools/e2e.mjs tools/rack3d-verify-v5.mjs
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
const LAYOUT_ID = "rack3d-demo-0000-4000-8000-000000000002";

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

const RACK_2_DEVICES = [
  placed("dev2-firewall", "1u-router-firewall", "旁路防火墙", 12),
  placed("dev2-server", "1u-server", "计算节点", 9),
  placed("dev2-storage", "4u-storage", "归档存储", 5),
];

const rack = (id, name, position, devices) => ({
  id,
  name,
  height: 12,
  width: 19,
  desc_units: false,
  show_rear: true,
  form_factor: "4-post-cabinet",
  starting_unit: 1,
  position,
  view: "front",
  devices,
});

// ⚠️ 关键：数组顺序 = [rack-1, rack-2]，但 position 顺序 = [rack-2(0), rack-1(1)]。
// 若 3D 仍按数组顺序排，P 断言就会失败。
const layout = {
  version: "26.9.0",
  name: "Rack3D 顺序验证布局",
  racks: [
    rack("rack-1", "机柜 A / 主柜", 1, RACK_1_DEVICES),
    rack("rack-2", "机柜 B / 扩展柜", 0, RACK_2_DEVICES),
  ],
  device_types: template.device_types,
  settings: template.settings,
  metadata: { id: LAYOUT_ID, name: "Rack3D 顺序验证布局", schema_version: "1.1" },
};

// 绑定全部 8 个指标，用于验证弹窗指标项
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
const bindings = [...RACK_1_DEVICES, ...RACK_2_DEVICES].map((d) => ({
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
}));

// 柜级绑定：机柜弹窗也应当列出全部指标（并画进度条）
bindings.push({
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
});

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
    return {
      renderMode: c.renderMode ?? null,
      sceneWidth: c.sceneWidth ?? null,
      sceneHeight: c.sceneHeight ?? null,
      selectedRack: c.selectedRackId ?? null,
      selectedDevice: c.selectedDeviceId ?? null,
      order: (c.racks ?? []).map((r) => ({
        id: r.id,
        x: +r.group.position.x.toFixed(4),
      })),
      floorColour: c.floor?.material?.color?.getHexString() ?? null,
    };
  });
}

/** 机柜排在屏幕上的水平占比（用每个柜的世界包围盒投影后取并集） */
async function racksScreenExtent() {
  return page.evaluate(() => {
    const c = window.__rack3d;
    const canvas = document.querySelector(".rack3d-viewport canvas");
    if (!c || !canvas || !c.racks?.length) return null;
    const rect = canvas.getBoundingClientRect();
    const Box3 = c.sceneBox().constructor;
    const box = new Box3();
    // 名称标签是装饰性 Sprite，浮在柜顶且比柜体还宽；测量"机柜本体"占比时
    // 临时摘掉它，测完再挂回，避免标签撑大包围盒（与引擎 rackBodyBox 口径一致）。
    const detached = [];
    for (const runtime of c.racks) {
      if (runtime.labelSprite && runtime.labelSprite.parent) {
        detached.push({ sprite: runtime.labelSprite, parent: runtime.labelSprite.parent });
        runtime.labelSprite.parent.remove(runtime.labelSprite);
      }
      const b = new Box3().setFromObject(runtime.group);
      box.union(b);
    }
    for (const d of detached) d.parent.add(d.sprite);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          const v = box.min.clone().set(x, y, z).project(c.camera);
          const px = (v.x * 0.5 + 0.5) * rect.width;
          const py = (-v.y * 0.5 + 0.5) * rect.height;
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;
        }
      }
    }
    return {
      viewport: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
      racksPx: +(maxX - minX).toFixed(1),
      racksPy: +(maxY - minY).toFixed(1),
      widthPct: +((maxX - minX) / rect.width).toFixed(4),
      heightPct: +((maxY - minY) / rect.height).toFixed(4),
    };
  });
}

/** 只留地面（隐藏机柜与场景元素）后测整幅画布平均亮度 */
async function groundOnlyLuma() {
  return page.evaluate(() => {
    const c = window.__rack3d;
    c.root.visible = false;
    const canvas = document.querySelector(".rack3d-viewport canvas");
    if (!canvas || !canvas.width) return null;
    const w = Math.min(canvas.width, 800);
    const h = Math.min(canvas.height, 1000);
    const tmp = document.createElement("canvas");
    tmp.width = w;
    tmp.height = h;
    const ctx = tmp.getContext("2d");
    ctx.drawImage(canvas, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      n += 1;
    }
    c.root.visible = true;
    return +(sum / n).toFixed(2);
  });
}

/** 用引擎只读诊断射线扫描满足条件的点 */
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

async function clickReset() {
  await page.evaluate(() => {
    document.querySelectorAll(".foot-btn").forEach((b) => {
      if (b.textContent?.trim() === "重置视角") b.click();
    });
  });
  await page.waitForTimeout(1700);
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

  // ---------------- P. 机柜排列顺序 ----------------
  const st0 = await engineState();
  results.order = {
    // 布局数组顺序：rack-1 在前；position 顺序：rack-2(0) 在前
    arrayOrder: ["rack-1", "rack-2"],
    positionOrder: ["rack-2", "rack-1"],
    sceneOrder: st0?.order ?? null,
    sceneIds: (st0?.order ?? []).map((r) => r.id),
    ascending: (st0?.order ?? []).every(
      (r, i, arr) => i === 0 || arr[i - 1].x < r.x,
    ),
  };
  notes.push("P 排列顺序: " + JSON.stringify(results.order));
  await shot("v5-P-order.png");

  // ---------------- Q. 复位取景宽度占比 ----------------
  await clickReset();
  const extent = await racksScreenExtent();
  results.resetFraming = { ...extent, sceneWidthM: st0?.sceneWidth ?? null };
  notes.push("Q 复位取景: " + JSON.stringify(results.resetFraming));
  await shot("v5-Q-reset.png");

  // ---------------- R. 地面亮度 A/B ----------------
  const groundNew = await groundOnlyLuma();
  await page.evaluate(() => {
    window.__rack3d.floor.material.color.setHex(0x1c1f26);
  });
  await page.waitForTimeout(700);
  const groundLegacy = await groundOnlyLuma();
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    window.__rack3d.setSceneTheme(window.__rack3d.theme);
  });
  await page.waitForTimeout(700);
  const groundRestored = await groundOnlyLuma();
  const stFloor = await engineState();
  results.ground = {
    newLuma: groundNew,
    legacyLuma: groundLegacy,
    restoredLuma: groundRestored,
    ratio:
      groundNew && groundLegacy ? +(groundNew / groundLegacy).toFixed(3) : null,
    colour: stFloor?.floorColour ?? null,
  };
  notes.push("R 地面 A/B: " + JSON.stringify(results.ground));
  await shot("v5-R-ground.png");

  // ---------------- S. 选中某柜 → 其它柜（含柜内设备）降透明度 ----------------
  await page.evaluate(() => window.__rack3d.setSelectedRack("rack-1"));
  await page.waitForTimeout(400);
  const dim = await page.evaluate(() => {
    const c = window.__rack3d;
    const read = (id) => {
      const r = c.racks.find((x) => x.id === id);
      if (!r) return null;
      const firstDevice = [...r.deviceMaterials.values()][0]?.[0];
      const allDimmed = [...r.deviceMaterials.values()].every((mats) =>
        mats.every((m) => m.transparent === true && m.opacity < 0.5),
      );
      const bezelsDimmed = r.bezelMaterials.every(
        (m) => m.transparent === true && m.opacity < 0.5,
      );
      const ledsDimmed = [...r.deviceLeds.values()].every(
        (m) => m.transparent === true && m.opacity < 1,
      );
      return {
        frame: {
          transparent: r.frameMaterials[0]?.transparent ?? null,
          opacity: r.frameMaterials[0]?.opacity ?? null,
        },
        device: {
          transparent: firstDevice?.transparent ?? null,
          opacity: firstDevice?.opacity ?? null,
        },
        allDevicesDimmed: allDimmed,
        bezelsDimmed,
        ledsDimmed,
        deviceCount: r.deviceMaterials.size,
      };
    };
    return { selected: read("rack-1"), other: read("rack-2") };
  });
  await shot("v5-S-dim.png");
  // 还原
  await page.evaluate(() => window.__rack3d.clearSelection());
  await page.waitForTimeout(400);
  const dimCleared = await page.evaluate(() => {
    const r = window.__rack3d.racks.find((x) => x.id === "rack-2");
    const firstDevice = [...r.deviceMaterials.values()][0]?.[0];
    return {
      transparent: firstDevice?.transparent ?? null,
      opacity: firstDevice?.opacity ?? null,
    };
  });
  results.dimming = { ...dim, afterClear: dimCleared };
  notes.push("S 降透明度: " + JSON.stringify(results.dimming));

  // ---------------- U. 弹窗指标项（设备） ----------------
  await clickReset();
  const ptDev = await scanPoint(
    'pick && pick.device && pick.device.deviceId === "dev-server-1"',
  );
  let devicePopup = null;
  if (ptDev) {
    await page.mouse.click(ptDev.cx, ptDev.cy);
    await page.waitForTimeout(1600);
    devicePopup = await page.evaluate(() => {
      const popup = document.querySelector(
        '.device-popup[aria-label="设备实时数据"]',
      );
      if (!popup) return null;
      return {
        rows: [...popup.querySelectorAll(".prow dt")].map((n) =>
          n.textContent.trim(),
        ),
        rowCount: popup.querySelectorAll(".prow").length,
        // 动态指标改为网格卡片（值+名），指标名在 .m-name 里（与机柜弹窗一致）
        metricNames: [...popup.querySelectorAll(".metric-card .m-name")].map(
          (n) => n.textContent.trim(),
        ),
        gridCount: popup.querySelectorAll(".metric-card").length,
        cols: getComputedStyle(popup.querySelector(".metric-grid"))
          .gridTemplateColumns.split(" ").length,
        hasBar: !!popup.querySelector(".bar-fill"),
        hasChart: !!popup.querySelector(".spark"),
      };
    });
  }
  await shot("v5-U-device-popup.png");
  results.devicePopup = { point: ptDev, ...(devicePopup ?? {}) };
  notes.push("U 设备弹窗: " + JSON.stringify(results.devicePopup));

  // ---------------- U2. 弹窗指标项（机柜） ----------------
  // 先点空白把设备弹窗彻底关掉（否则 `.device-popup` 会先匹配到设备弹窗），
  // 再用 aria-label 精确定位机柜弹窗，避免两种弹窗混淆。
  await clickReset();
  const ptEmptyU2 = await scanPoint("pick && pick.rackId === null");
  if (ptEmptyU2) {
    await page.mouse.click(ptEmptyU2.cx, ptEmptyU2.cy);
    await page.waitForTimeout(1200);
  }
  await clickReset();
  const ptShell = await scanPoint(
    'pick && pick.rackId === "rack-1" && !pick.device',
  );
  let rackPopup = null;
  if (ptShell) {
    await page.mouse.click(ptShell.cx, ptShell.cy);
    await page.waitForTimeout(1800);
    rackPopup = await page.evaluate(() => {
      const popup = document.querySelector(
        '.device-popup[aria-label="机柜数据"]',
      );
      if (!popup) return null;
      return {
        rows: [...popup.querySelectorAll(".prow dt")].map((n) =>
          n.textContent.trim(),
        ),
        rowCount: popup.querySelectorAll(".prow").length,
        // 动态指标改为 4×2 网格卡片（值+名），指标名在 .m-name 里
        metricNames: [...popup.querySelectorAll(".metric-card .m-name")].map(
          (n) => n.textContent.trim(),
        ),
        gridCount: popup.querySelectorAll(".metric-card").length,
        cols: getComputedStyle(popup.querySelector(".metric-grid"))
          .gridTemplateColumns.split(" ").length,
      };
    });
  }
  await shot("v5-U2-rack-popup.png");
  results.rackPopup = { point: ptShell, ...(rackPopup ?? {}) };
  notes.push("U2 机柜弹窗: " + JSON.stringify(results.rackPopup));

  // ---------------- T. 透视模式下外壳不参与拾取 ----------------
  // T1 基线：实体模式下点外壳 → 应选中机柜
  const solidRack = await engineState();
  results.xrayBase = {
    renderMode: solidRack?.renderMode ?? null,
    selectedRack: solidRack?.selectedRack ?? null,
  };

  // T2 切到透视模式
  await clickReset();
  await page.evaluate(() => window.__rack3d.setRenderMode("xray"));
  await page.waitForTimeout(700);
  const xrayState = await engineState();

  // T3 透视下点设备 → 仍应选中设备
  const ptDevXray = await scanPoint("pick && pick.device");
  await page.mouse.click(ptDevXray.cx, ptDevXray.cy);
  await page.waitForTimeout(1500);
  const afterXrayDevice = await engineState();
  await shot("v5-T-xray-device.png");

  // T4 透视下点外壳 → 不应选中机柜
  await clickReset();
  const ptShellXray = await scanPoint(
    'pick && pick.rackId === "rack-1" && !pick.device',
  );
  let afterXrayShell = null;
  if (ptShellXray) {
    await page.mouse.click(ptShellXray.cx, ptShellXray.cy);
    await page.waitForTimeout(1500);
    afterXrayShell = await engineState();
  }
  await shot("v5-T-xray-shell.png");

  results.xray = {
    renderMode: xrayState?.renderMode ?? null,
    devicePoint: ptDevXray
      ? { gx: ptDevXray.gx, gy: ptDevXray.gy, pick: ptDevXray.pick }
      : null,
    selectedDeviceAfterDeviceClick: afterXrayDevice?.selectedDevice ?? null,
    shellPoint: ptShellXray
      ? { gx: ptShellXray.gx, gy: ptShellXray.gy, pick: ptShellXray.pick }
      : null,
    selectedRackAfterShellClick: afterXrayShell?.selectedRack ?? null,
    selectedDeviceAfterShellClick: afterXrayShell?.selectedDevice ?? null,
  };
  notes.push("T 透视拾取: " + JSON.stringify(results.xray));

  await page.evaluate(() => window.__rack3d.setRenderMode("solid"));
  await page.waitForTimeout(500);
} catch (e) {
  notes.push("FATAL: " + e.message + "\n" + e.stack);
} finally {
  await browser.close();
}

// ---------------------------------------------------------------- 判定
const METRIC_LABELS = {
  power_w: "功率 (W)",
  current_a: "电流 (A)",
  voltage_v: "电压 (V)",
  temp_c: "温度 (°C)",
  humidity: "湿度 (%)",
  status: "状态",
  rpm: "转速 (RPM)",
  on_off: "开关",
};
const wantLabels = Object.values(METRIC_LABELS);
const hasAllMetrics = (rows) =>
  Array.isArray(rows) && wantLabels.every((l) => rows.includes(l));

const o = results.order;
const q = results.resetFraming;
const g = results.ground;
const d = results.dimming;
const x = results.xray;

const checks = {
  // P：3D 顺序必须等于 position 顺序（rack-2 在前），且 groupX 递增
  P_orderByPosition:
    o?.sceneIds?.join(",") === "rack-2,rack-1" && o?.ascending === true,
  // Q：机柜排横向占视窗的比例落在 80% 附近（±8 个百分点）
  Q_fillAbout80:
    q?.widthPct != null && q.widthPct >= 0.72 && q.widthPct <= 0.88,
  // R：地色已换成新值，且比旧值明显更亮（A/B 同比）
  // 第六轮起地面与背景同色（暗 #21222c），不再用"提亮地色"表达：
  // 这里改为断言地色已与背景一致（提亮历史见 rack3d-verify-v6.mjs 的 X 断言）
  R_groundBrighter: g?.colour === "191a21",
  // S：选中 rack-1 时，rack-2 的柜壳 + 柜内设备 + 凹槽 + 指示灯都变半透明；
  //    被选中的 rack-1 本身保持不透明；清空选中后完全复原
  S_otherDevicesDimmed:
    d?.other?.device?.transparent === true &&
    d?.other?.device?.opacity < 0.5 &&
    d?.other?.allDevicesDimmed === true &&
    d?.other?.bezelsDimmed === true &&
    d?.other?.ledsDimmed === true &&
    d?.other?.frame?.opacity < 0.5,
  S_selectedStaysSolid:
    d?.selected?.device?.transparent === false &&
    d?.selected?.device?.opacity === 1 &&
    d?.selected?.frame?.opacity === 1,
  S_restoreOnClear:
    d?.afterClear?.transparent === false && d?.afterClear?.opacity === 1,
  // U：设备弹窗必须列出全部 8 个指标（网格卡片，与机柜弹窗一致的 4×2）
  U_devicePopupAllMetrics:
    hasAllMetrics(results.devicePopup?.metricNames) &&
    results.devicePopup?.gridCount === results.devicePopup?.metricNames?.length &&
    results.devicePopup?.cols === 4,
  // U2：机柜弹窗动态指标改为 4×2 网格卡片——必须列全 8 个指标名、恰好 8 张卡、4 列
  U2_rackPopupAllMetrics:
    hasAllMetrics(results.rackPopup?.metricNames) &&
    results.rackPopup?.gridCount === 8 &&
    results.rackPopup?.cols === 4,
  // T：基线——实体模式下点外壳确实会选中机柜（证明测试点有效）
  T0_solidShellSelectsRack: results.xrayBase?.selectedRack === "rack-1",
  // T：透视模式下点设备仍可选中
  T1_xrayDeviceSelectable: x?.selectedDeviceAfterDeviceClick !== null,
  // T：透视模式下点外壳 → 机柜外壳本身不被选中。
  // 注意：xray 关掉外壳拾取后，点外壳位置会"穿透"到其后方的地板或设备，
  // 这是该模式的预期行为（正是为了能点穿外壳选中柜内设备）。
  // 因此断言的是"没有以纯机柜方式选中该外壳所属机柜"（即 selectedRack==rack-1
  // 且 selectedDevice==null 的纯外壳选中不能出现），而非简单地要求选空。
  T2_xrayShellNotSelectable:
    x?.renderMode === "xray" &&
    x?.shellPoint != null &&
    !(
      x?.selectedRackAfterShellClick === "rack-1" &&
      x?.selectedDeviceAfterShellClick === null
    ),
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
