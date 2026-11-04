/**
 * Rack3D 第三轮改动（几何对齐 / 机柜交互 / 遮罩轮廓 / 取景距离）端到端客观验证
 * ===========================================================================
 * 覆盖断言：
 *   A. 设备盒体**底边**贴合 U 槽底（不再整体上浮 / 不与顶板穿模）
 *   B. 任意机柜点击都能弹出机柜弹窗（不只是第一个机柜）
 *   C. 选中机柜时其余机柜转半透明
 *   D. Selection Outline 走深度/ID 遮罩 + 合并通道（maskActive + 出现选中色像素）
 *   E. 轮廓被前方几何体遮挡时**弱化显示**（顶视图强度明显低于正视图，但不为 0）
 *   F. 聚焦填充比：机柜占视窗宽度 80%、设备占 85%
 *   G. 无选中时复位到「全部设备都可见」的取景
 *   H. 黑白两套三维场景主题可切换（背景亮度随主题变化）
 *   I. 2D 画布选中机柜 → 3D 整柜选中 + 弹窗（双向同步）
 *   J. 2D 画布无选中 → 3D 复位到未选中、关闭弹窗
 *
 * 关键点：点击坐标**不再靠手填比例**猜。
 *   Rack3D 视口是竖长条（canvas 宽高比 ≈ 0.56），场景按宽度受限取景，
 *   机柜只占屏幕中间约 1/4 高度；任何硬编码的 (0.1, 0.8) 之类比例都会
 *   落在机柜之外 —— 这正是上一版 B/C 断言"点什么都没反应"的原因。
 *   现在用引擎自带的只读诊断射线 debugProbe() 在画布上**扫描**出满足条件的
 *   坐标（命中指定机柜且未命中设备 / 命中指定设备 / 什么都没命中），再点它。
 *
 * 用法：node tools/e2e.mjs tools/rack3d-verify-v3.mjs
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
const U_HEIGHT_M = 0.04445;
/** 机柜 group 包围盒半宽：19in 板宽 + 侧板 6mm（取景用的是 group 包围盒） */
const RACK_GROUP_HALF_W = (19 * 0.0254) / 2 + 0.003;
const LAYOUT_ID = "rack3d-demo-0000-4000-8000-000000000001";

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
  placed("dev-patch", "24-port-patch-panel", "配线架", 10),
  placed("dev-server-1", "1u-server", "应用服务器", 9),
  placed("dev-server-2", "1u-server", "备份服务器", 8),
  placed("dev-nas", "4u-storage", "NAS 存储", 4),
  placed("dev-ups", "2u-ups", "UPS 电源", 2),
];
const RACK_2_DEVICES = [
  placed("dev2-firewall", "1u-router-firewall", "旁路防火墙", 12),
  placed("dev2-switch", "24-port-switch", "接入交换机", 11),
  placed("dev2-server", "1u-server", "计算节点", 9),
  placed("dev2-storage", "4u-storage", "归档存储", 5),
  placed("dev2-ups", "2u-ups", "UPS 电源", 2),
];

const layout = {
  version: "26.9.0",
  name: "Rack3D 演示布局",
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
    {
      id: "rack-2",
      name: "机柜 B / 扩展柜",
      height: 12,
      width: 19,
      desc_units: false,
      show_rear: true,
      form_factor: "4-post-cabinet",
      starting_unit: 1,
      position: 1,
      view: "front",
      devices: RACK_2_DEVICES,
    },
  ],
  device_types: template.device_types,
  settings: template.settings,
  metadata: { id: LAYOUT_ID, name: "Rack3D 演示布局", schema_version: "1.1" },
};

const bindings = [...RACK_1_DEVICES, ...RACK_2_DEVICES].map((d) => ({
  id: `bind-${d.id}`,
  asset_kind: "device",
  asset_id: d.id,
  label: d.name,
  adapter: "mock",
  endpoint: "mock://local",
  metrics: ["power_w", "temp_c", "status", "on_off"],
  point_map: {},
  thresholds: {},
  poll_ms: 1500,
}));

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

/** 选中色（粉）像素占比 + 内容包围盒（原生分辨率、色相判色，避免细线被稀释） */
async function canvasStats() {
  return page.evaluate(() => {
    const c = document.querySelector(".rack3d-viewport canvas");
    if (!c || !c.width) return null;
    const w = Math.min(c.width, 900);
    const h = Math.min(c.height, 1400);
    const tmp = document.createElement("canvas");
    tmp.width = w;
    tmp.height = h;
    const ctx = tmp.getContext("2d");
    ctx.drawImage(c, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;

    let nonBg = 0;
    let pink = 0;
    let maxRG = 0;
    let minX = w;
    let maxX = -1;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      if (Math.abs(r - 20) > 14 || Math.abs(g - 22) > 14 || Math.abs(b - 28) > 14) {
        nonBg += 1;
      }
      // 宽松的"偏粉"判据：用来量轮廓的**强度**（r-g 正比于混色 alpha）
      if (r > 90 && b > 70 && b - g > 8 && r - g > 15) {
        if (r - g > maxRG) maxRG = r - g;
      }
      // 粉 #ff79c6：红高、蓝次之、绿最低
      if (r > 110 && b > 85 && r - g > 40 && b - g > 12) {
        pink += 1;
        const px = (i / 4) % w;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
      }
    }
    const total = w * h;
    const pct = (n) => +((n / total) * 100).toFixed(2);
    return {
      size: `${c.width}x${c.height}`,
      nonBg: pct(nonBg),
      pink: pct(pink),
      maxRG,
      pinkSpanFrac: maxX >= 0 ? +((maxX - minX + 1) / w).toFixed(3) : 0,
    };
  });
}

/** 画布四角平均亮度（判定场景主题：暗色 ≈ 20，亮色 ≈ 200+） */
async function canvasBgLuma() {
  return page.evaluate(() => {
    const c = document.querySelector(".rack3d-viewport canvas");
    if (!c || !c.width) return null;
    const tmp = document.createElement("canvas");
    tmp.width = c.width;
    tmp.height = c.height;
    const ctx = tmp.getContext("2d");
    ctx.drawImage(c, 0, 0);
    const pts = [
      [2, 2],
      [c.width - 3, 2],
      [2, c.height - 3],
      [c.width - 3, c.height - 3],
    ];
    let sum = 0;
    for (const [x, y] of pts) {
      const d = ctx.getImageData(x, y, 1, 1).data;
      sum += 0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2];
    }
    return +(sum / pts.length).toFixed(1);
  });
}

/** 引擎内部状态（TS 的 private 只是编译期约束，运行期可直接读） */
async function engineState() {
  return page.evaluate(() => {
    const c = window.__rack3d;
    if (!c) return null;
    return {
      cameraMode: c.cameraMode,
      viewPreset: c.viewPreset,
      theme: c.theme,
      viewAspect: c.viewAspect,
      orthoTop: c.orthoCamera.top,
      target: c.controls.target
        .toArray()
        .map((n) => +n.toFixed(4)),
      maskActive: c.maskActive,
      outlineColour: c.compositeMaterial.uniforms.uColour.value.getHexString(),
      outlineThickness: c.compositeMaterial.uniforms.uThickness.value,
      selectedDevice: c.selectedDeviceId ?? null,
      selectedRack: c.selectedRackId ?? null,
      hasMaskUniform: c.compositeMaterial.uniforms.uHasMask.value,
      racks: c.racks.map((r) => ({
        id: r.id,
        groupX: +r.group.position.x.toFixed(4),
        frameOpacity: r.frameMaterials[0]?.opacity ?? null,
        sideOpacity: r.sideMaterials[0]?.opacity ?? null,
      })),
    };
  });
}

/** 设备盒体在世界坐标下的上下边界（验证"底边贴合槽底"） */
async function deviceBoxBounds() {
  return page.evaluate(() => {
    const c = window.__rack3d;
    const out = {};
    for (const [id, mesh] of c.deviceMeshes) {
      mesh.geometry.computeBoundingBox();
      const bb = mesh.geometry.boundingBox;
      out[id] = {
        minY: +(mesh.position.y + bb.min.y).toFixed(6),
        maxY: +(mesh.position.y + bb.max.y).toFixed(6),
        halfWidthX: +((bb.max.x - bb.min.x) / 2).toFixed(6),
      };
    }
    return out;
  });
}

/**
 * 用引擎的只读诊断射线在画布上扫描出满足条件的点击坐标。
 * criteria:
 *   { rackId }        → 命中该机柜且未命中设备（= 柜体本身，如立柱/顶底板）
 *   { deviceId }      → 命中该设备
 *   { empty: true }   → 什么都没命中（空白画布）
 * 返回画布 CSS 坐标 { cx, cy, gx, gy }；找不到返回 null。
 */
async function findPoint(criteria) {
  return page.evaluate((criteria) => {
    const c = window.__rack3d;
    const canvas = document.querySelector(".rack3d-viewport canvas");
    if (!c || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    for (let gy = 0.03; gy <= 0.97; gy += 0.015) {
      for (let gx = 0.03; gx <= 0.97; gx += 0.008) {
        const cx = rect.left + rect.width * gx;
        const cy = rect.top + rect.height * gy;
        let info = null;
        try {
          info = c.debugProbe(cx, cy);
        } catch {
          info = null;
        }
        const pick = info && info.pick;
        if (!pick) continue;
        if (criteria.empty) {
          if (pick.rackId === null && !pick.device) {
            return { gx: +gx.toFixed(4), gy: +gy.toFixed(4), cx, cy };
          }
          continue;
        }
        if (criteria.deviceId) {
          if (pick.device && pick.device.deviceId === criteria.deviceId) {
            return { gx: +gx.toFixed(4), gy: +gy.toFixed(4), cx, cy };
          }
          continue;
        }
        if (pick.rackId === criteria.rackId && !pick.device) {
          return { gx: +gx.toFixed(4), gy: +gy.toFixed(4), cx, cy };
        }
      }
    }
    return null;
  }, criteria);
}

/** 点击画布坐标并回读当前弹出的卡片名字（设备/机柜弹窗共用 .device-popup） */
async function clickAndReadName(pt) {
  await page.mouse.click(pt.cx, pt.cy);
  await page.waitForTimeout(900);
  const names = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".device-popup .popup-name"))
      .map((n) => n.textContent?.trim() ?? "")
      .filter(Boolean),
  );
  return names;
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
    },
    { layoutId: LAYOUT_ID, layout, bindings },
  );

  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(7000);

  await page.locator(".rack3d-launcher").first().click({ timeout: 8000 });
  await page.waitForTimeout(5000);

  const box = await page.locator(".rack3d-viewport canvas").boundingBox();
  const diag = await engineState();
  results.diagnostic = {
    canvasBox: box,
    canvasAspect: box ? +(box.width / box.height).toFixed(3) : null,
    engineAspect: diag?.viewAspect ?? null,
    orthoTop: diag?.orthoTop ?? null,
    cameraMode: diag?.cameraMode ?? null,
    viewPreset: diag?.viewPreset ?? null,
    racks: diag?.racks ?? null,
  };
  notes.push("DIAG 画布/取景: " + JSON.stringify(results.diagnostic));

  // ---------- A. 设备底边贴合槽底 ----------
  const bounds = await deviceBoxBounds();
  const expected = [...RACK_1_DEVICES, ...RACK_2_DEVICES].map((d) => ({
    id: d.id,
    uHeight:
      template.device_types.find((t) => t.slug === d.device_type)?.u_height ?? 1,
    slotBottom: (d.position / UNITS_PER_U - 1) * U_HEIGHT_M,
  }));
  const misaligned = [];
  for (const item of expected) {
    const actual = bounds[item.id];
    if (!actual) {
      misaligned.push({ id: item.id, reason: "missing" });
      continue;
    }
    const delta = +(actual.minY - item.slotBottom).toFixed(6);
    if (Math.abs(delta) > 1e-5) {
      misaligned.push({
        id: item.id,
        delta,
        expected: +item.slotBottom.toFixed(6),
        actual: actual.minY,
      });
    }
  }
  // 顶柜设备（U12）顶面必须低于柜内净高，避免与顶板穿模
  const topDevice = bounds["dev-firewall"];
  const rackInnerTop = 12 * U_HEIGHT_M;
  results.geometry = {
    deviceCount: Object.keys(bounds).length,
    misaligned,
    topDeviceMaxY: topDevice?.maxY ?? null,
    rackInnerTop: +rackInnerTop.toFixed(6),
    topDeviceFits: topDevice ? topDevice.maxY < rackInnerTop : false,
  };
  notes.push("A 几何对齐: " + JSON.stringify(results.geometry));
  await shot("v3-A-geometry.png");

  // ---------- 切正视图（后续断言都在正视图下量取景） ----------
  await page.selectOption(".view-select", "front");
  await page.waitForTimeout(1800);
  notes.push("切正视图后 preset = " + (await engineState())?.viewPreset);

  // ---------- 预扫描点击点 ----------
  // 必须在**全场景取景**下一次性取好：只要选中了某个机柜，自动聚焦就会把
  // 相机推到那个柜上，另一个机柜随即移出视野，之后再扫就永远扫不到了。
  const ptRack1 = await findPoint({ rackId: "rack-1" });
  const ptRack2 = await findPoint({ rackId: "rack-2" });
  const ptEmpty = await findPoint({ empty: true });
  notes.push(
    "预扫描点位: " + JSON.stringify({ ptRack1, ptRack2, ptEmpty }),
  );

  // ---------- B-1 / C-1. 点 rack-1 柜体 ----------
  const names1 = ptRack1 ? await clickAndReadName(ptRack1) : [];
  const dimState1 = await engineState();
  const op11 = dimState1?.racks.find((r) => r.id === "rack-1")?.frameOpacity ?? null;
  const op12 = dimState1?.racks.find((r) => r.id === "rack-2")?.frameOpacity ?? null;
  results.rackPopup = {
    rack1Point: ptRack1,
    rack1PopupNames: names1,
    rack1Popup: names1.includes("机柜 A / 主柜"),
  };
  results.rackDimming1 = {
    selected: dimState1?.selectedRack ?? null,
    rack1FrameOpacity: op11,
    rack2FrameOpacity: op12,
    dimsOther:
      dimState1?.selectedRack === "rack-1" &&
      (op12 ?? 1) < 0.3 &&
      (op11 ?? 0) > 0.9,
  };
  notes.push("B1 机柜A弹窗: " + JSON.stringify(results.rackPopup));
  notes.push("C1 他柜半透明: " + JSON.stringify(results.rackDimming1));
  await shot("v3-B1-rack1-popup.png");

  // 点空白：清空选中 + 复位到全场景取景（为下一个机柜恢复取景）
  await page.mouse.click(ptEmpty.cx, ptEmpty.cy);
  await page.waitForTimeout(1800);
  const afterEmpty1 = await engineState();
  results.clearViaEmpty = {
    selectedRack: afterEmpty1?.selectedRack ?? null,
    selectedDevice: afterEmpty1?.selectedDevice ?? null,
    orthoTop: afterEmpty1?.orthoTop ?? null,
    cleared:
      afterEmpty1?.selectedRack === null && afterEmpty1?.selectedDevice === null,
  };
  notes.push("点空白清空选中: " + JSON.stringify(results.clearViaEmpty));

  // ---------- B-2 / C-2. 点 rack-2 柜体（用户报的"第二个机柜点不出弹窗"） ----------
  const names2 = ptRack2 ? await clickAndReadName(ptRack2) : [];
  const dimState2 = await engineState();
  const op21 = dimState2?.racks.find((r) => r.id === "rack-1")?.frameOpacity ?? null;
  const op22 = dimState2?.racks.find((r) => r.id === "rack-2")?.frameOpacity ?? null;
  results.rackPopup.rack2Point = ptRack2;
  results.rackPopup.rack2PopupNames = names2;
  results.rackPopup.rack2Popup = names2.includes("机柜 B / 扩展柜");
  results.rackDimming2 = {
    selected: dimState2?.selectedRack ?? null,
    rack1FrameOpacity: op21,
    rack2FrameOpacity: op22,
    dimsOther:
      dimState2?.selectedRack === "rack-2" &&
      (op21 ?? 1) < 0.3 &&
      (op22 ?? 0) > 0.9,
  };
  notes.push("B2 机柜B弹窗: " + JSON.stringify(results.rackPopup));
  notes.push("C2 他柜半透明: " + JSON.stringify(results.rackDimming2));
  await shot("v3-B2-rack2-popup.png");

  // ---------- F1. 机柜聚焦填充比（宽度应占视窗 80%） ----------
  // 选中 rack-2 触发了自动聚焦（补间），等镜头停稳再量
  await page.waitForTimeout(1800);
  const rackFocusState = await engineState();
  const rackFill =
    RACK_GROUP_HALF_W /
    (rackFocusState.orthoTop * rackFocusState.viewAspect);
  results.rackFill = {
    halfWidthUsed: +RACK_GROUP_HALF_W.toFixed(4),
    orthoTop: rackFocusState.orthoTop,
    aspect: rackFocusState.viewAspect,
    fill: +rackFill.toFixed(3),
  };
  notes.push("F1 机柜填充比: " + JSON.stringify(results.rackFill));

  // ---------- D. 遮罩轮廓 ----------
  // 选中 rack-2 内一台设备（4U 归档存储，体积大、好点）
  const ptDevice = await findPoint({ deviceId: "dev2-storage" });
  const deviceNames = ptDevice ? await clickAndReadName(ptDevice) : [];
  const outlineState = await engineState();
  const outlineStats = await canvasStats();
  results.outline = {
    clickPoint: ptDevice,
    devicePopupNames: deviceNames,
    maskActive: outlineState?.maskActive ?? null,
    hasMaskUniform: outlineState?.hasMaskUniform ?? null,
    outlineColour: outlineState?.outlineColour ?? null,
    outlineThickness: outlineState?.outlineThickness ?? null,
    selectedDevice: outlineState?.selectedDevice ?? null,
    pinkPct: outlineStats?.pink ?? null,
    pinkMaxRG: outlineStats?.maxRG ?? null,
    pinkSpanFrac: outlineStats?.pinkSpanFrac ?? null,
  };
  notes.push("D 遮罩轮廓: " + JSON.stringify(results.outline));
  await shot("v3-D-outline.png");

  // ---------- F2. 设备聚焦填充比（宽度应占视窗 85%） ----------
  const deviceBounds = await deviceBoxBounds();
  const selectedId = await page.evaluate(
    () => window.__rack3d.selectedDeviceId ?? null,
  );
  const halfWidthDevice = selectedId ? deviceBounds[selectedId]?.halfWidthX : null;
  const deviceFocusState = await engineState();
  const deviceFill =
    halfWidthDevice !== null
      ? halfWidthDevice / (deviceFocusState.orthoTop * deviceFocusState.viewAspect)
      : null;
  results.deviceFill = {
    selectedId,
    halfWidthDevice,
    orthoTop: deviceFocusState.orthoTop,
    aspect: deviceFocusState.viewAspect,
    fill: deviceFill === null ? null : +deviceFill.toFixed(3),
  };
  notes.push("F2 设备填充比: " + JSON.stringify(results.deviceFill));

  // ---------- E. 轮廓被前方几何体遮挡时「弱化但不消失」 ----------
  // 顶视图：设备被机柜顶板挡住。轮廓环仍在设备投影处画出来（提示方位），
  // 但混色强度只有露出来时的一半左右 —— 用 r-g 通道差当强度代理量。
  await page.selectOption(".view-select", "top");
  await page.waitForTimeout(1800);
  const topStats = await canvasStats();
  await shot("v3-E-top-occluded.png");
  await page.selectOption(".view-select", "front");
  await page.waitForTimeout(1800);
  const backStats = await canvasStats();
  const frontMaxRG = outlineStats?.maxRG ?? 0;
  const topMaxRG = topStats?.maxRG ?? 0;
  results.occlusion = {
    frontPink: outlineStats?.pink ?? null,
    frontMaxRG,
    topPink: topStats?.pink ?? null,
    topMaxRG,
    frontPinkBack: backStats?.pink ?? null,
    // 被遮挡的一段仍可见（maxRG 明显 > 15），但强度低于露出段（< 75%）
    weakenedWhenOccluded:
      topMaxRG > 15 && frontMaxRG > 40 && topMaxRG < frontMaxRG * 0.75,
  };
  notes.push("E 轮廓遮挡弱化: " + JSON.stringify(results.occlusion));
  await shot("v3-E-back-front.png");

  // ---------- G. 无选中 → 复位到全场景 ----------
  await page.evaluate(() => {
    document.querySelectorAll(".foot-btn").forEach((b) => {
      if (b.textContent?.trim() === "重置视角") b.click();
    });
  });
  await page.waitForTimeout(1800);
  const sceneState = await engineState();
  const sceneTop = sceneState?.orthoTop ?? null;

  // 点画布空白处 → 清空选中（应同时把取景复位到全场景）
  const sceneAfterName = ptEmpty ? await clickAndReadName(ptEmpty) : [];
  await page.waitForTimeout(1200);
  const afterClear = await engineState();
  results.resetOnClear = {
    emptyPoint: ptEmpty,
    popupAfterEmptyClick: sceneAfterName,
    sceneTop,
    topAfterReset: sceneTop,
    topAfterEmptyClick: afterClear?.orthoTop ?? null,
    selectedAfter: {
      rack: afterClear?.selectedRack ?? null,
      device: afterClear?.selectedDevice ?? null,
    },
    cleared:
      afterClear?.selectedRack === null && afterClear?.selectedDevice === null,
    restoresSceneFraming:
      sceneTop !== null &&
      afterClear?.orthoTop != null &&
      Math.abs((afterClear?.orthoTop ?? 0) - sceneTop) < 1e-6,
  };
  notes.push("G 无选中复位: " + JSON.stringify(results.resetOnClear));
  await shot("v3-G-reset.png");

  // ---------- H. 黑白两套场景主题切换 ----------
  await page.evaluate(() => {
    document.querySelectorAll(".rack3d-tools .seg-btn").forEach((b) => {
      if (b.textContent?.trim() === "亮色") b.click();
    });
  });
  await page.waitForTimeout(1500);
  const lightState = await engineState();
  const lightLuma = await canvasBgLuma();
  await shot("v3-H-theme-light.png");
  await page.evaluate(() => {
    document.querySelectorAll(".rack3d-tools .seg-btn").forEach((b) => {
      if (b.textContent?.trim() === "暗色") b.click();
    });
  });
  await page.waitForTimeout(1500);
  const darkState = await engineState();
  const darkLuma = await canvasBgLuma();
  await shot("v3-H-theme-dark.png");
  results.theme = {
    lightTheme: lightState?.theme ?? null,
    lightBgLuma: lightLuma,
    darkTheme: darkState?.theme ?? null,
    darkBgLuma: darkLuma,
    switches:
      lightState?.theme === "light" &&
      darkState?.theme === "dark" &&
      (lightLuma ?? 0) > 150 &&
      (darkLuma ?? 255) < 80,
  };
  notes.push("H 场景主题切换: " + JSON.stringify(results.theme));

  // ---------- I. 2D 画布选中机柜 → 3D 整柜选中 + 弹窗 ----------
  const rackBox = await page.locator(".rack-container").first().boundingBox();
  let syncPopupNames = [];
  let syncRackPoint = null;
  if (rackBox) {
    // 依次试几个落在"空 U 位"的纵向比例，命中机柜本体（而非设备）
    for (const ratio of [0.94, 0.79, 0.62]) {
      const x = rackBox.x + rackBox.width / 2;
      const y = rackBox.y + rackBox.height * ratio;
      await page.mouse.click(x, y);
      await page.waitForTimeout(1700);
      syncPopupNames = await page.evaluate(() =>
        Array.from(document.querySelectorAll(".device-popup .popup-name")).map(
          (n) => n.textContent?.trim() ?? "",
        ),
      );
      if (syncPopupNames.length > 0) {
        syncRackPoint = { x: +x.toFixed(1), y: +y.toFixed(1), ratio };
        break;
      }
    }
  }
  const syncState = await engineState();
  results.sync2dTo3d = {
    rackBox,
    clickedAt: syncRackPoint,
    selectedRack: syncState?.selectedRack ?? null,
    selectedDevice: syncState?.selectedDevice ?? null,
    popupNames: syncPopupNames,
    synced:
      syncState?.selectedRack === "rack-1" &&
      syncPopupNames.includes("机柜 A / 主柜"),
  };
  notes.push("I 2D→3D 机柜同步: " + JSON.stringify(results.sync2dTo3d));
  await shot("v3-I-2d-to-3d.png");

  // ---------- J. 2D 画布点到空白 → 3D 复位到未选中 ----------
  const canvasBox = await page.locator('[data-testid="rack-canvas"]').boundingBox();
  if (canvasBox) {
    // 左下角通常是画布空白区
    await page.mouse.click(
      canvasBox.x + 14,
      canvasBox.y + canvasBox.height - 14,
    );
    await page.waitForTimeout(1700);
  }
  const clearedState = await engineState();
  const clearedPopup = await page.evaluate(
    () => document.querySelectorAll(".device-popup").length,
  );
  results.clear2dTo3d = {
    canvasBox,
    selectedRack: clearedState?.selectedRack ?? null,
    selectedDevice: clearedState?.selectedDevice ?? null,
    openPopups: clearedPopup,
    cleared:
      clearedState?.selectedRack === null &&
      clearedState?.selectedDevice === null &&
      clearedPopup === 0,
  };
  notes.push("J 2D 清空→3D 复位: " + JSON.stringify(results.clear2dTo3d));
  await shot("v3-J-2d-cleared.png");

  // 收尾：清空控制台噪声
  await page.waitForTimeout(400);
} catch (e) {
  notes.push("FATAL: " + e.message);
} finally {
  await browser.close();
}

// ---------------------------------------------------------------- 判定
const checks = {
  A_geometry:
    results.geometry?.misaligned.length === 0 &&
    results.geometry?.topDeviceFits === true,
  B_rackPopup:
    results.rackPopup?.rack1Popup === true && results.rackPopup?.rack2Popup === true,
  C_rackDimming:
    results.rackDimming1?.dimsOther === true &&
    results.rackDimming2?.dimsOther === true,
  D_outline:
    results.outline?.maskActive === true &&
    results.outline?.hasMaskUniform === 1 &&
    results.outline?.selectedDevice === "dev2-storage" &&
    (results.outline?.pinkPct ?? 0) > 0.3,
  E_occlusion: results.occlusion?.weakenedWhenOccluded === true,
  F1_rackFill:
    results.rackFill?.fill != null &&
    results.rackFill.fill >= 0.75 &&
    results.rackFill.fill <= 0.85,
  // 设备聚焦填充比第六轮起从 0.85 调到 0.70（按包围盒宽度占屏幕 70%）
  F2_deviceFill:
    results.deviceFill?.fill != null &&
    results.deviceFill.fill >= 0.64 &&
    results.deviceFill.fill <= 0.76,
  G_resetFraming:
    results.resetOnClear?.restoresSceneFraming === true &&
    results.resetOnClear?.cleared === true,
  H_theme: results.theme?.switches === true,
  I_sync2dTo3d: results.sync2dTo3d?.synced === true,
  J_clear2dResets3d: results.clear2dTo3d?.cleared === true,
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
console.log("\n=== ERRORS (" + errors.length + ") ===\n" + errors.slice(0, 20).join("\n"));
