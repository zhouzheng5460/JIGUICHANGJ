/**
 * Rack3D 第四轮改动专项验证：环境光照（去雾 / 半球光 / 材质提亮）+ 相机复位不跳回
 * =================================================================================
 * 覆盖断言：
 *   K. 场景**不使用雾**（scene.fog === null）
 *   L. 半球光已增强且照亮暗部（hemiLight 存在、intensity 提高、groundColor 提亮）；
 *      机身材质金属度压低（无环境贴图时金属度 = 变暗），实测模型像素平均亮度达标
 *   M. **点空白复位后不再跳回聚焦**：
 *        先在 2D 画布选中机柜（相机聚焦该柜），再点 2D 画布空白。
 *        旧行为：复位到全场景后，自动聚焦的 $effect 因 layoutStore.activeRackId
 *        未被清空又 focusRack() 跳回去。
 *        现在断言：复位后 orthoTop === 全场景取景值，且**再等 3 秒仍不变**，
 *        同时 activeRackId 仍残留着旧机柜（说明修复点确实生效，而不是靠"顺带清掉了"）。
 *   N. 3D 视窗内点空白 → 仍能清空选中 + 复位（回归保护）
 *
 * 用法：node tools/e2e.mjs tools/rack3d-verify-v4.mjs
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

// ⚠️ 必须注入 mock 遥测绑定：没有绑定 = 所有设备都是「未接入」灰色，
// 设备面板统计（绿色系像素）会恒为 0，看起来像"读画布坏了"，其实是数据没喂。
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

/** 引擎内部状态（TS private 只是编译期约束） */
async function engineState() {
  return page.evaluate(() => {
    const c = window.__rack3d;
    if (!c) return null;
    return {
      theme: c.theme,
      viewAspect: c.viewAspect,
      orthoTop: c.orthoCamera.top,
      viewPreset: c.viewPreset,
      selectedRack: c.selectedRackId ?? null,
      selectedDevice: c.selectedDeviceId ?? null,
      // 3D 侧高亮用的活动机柜（由 layoutStore.activeRackId 同步过来）
      activeRackId: c.activeRackId ?? null,
      fog: c.scene?.fog ?? null,
      fogType: c.scene?.fog ? c.scene.fog.constructor?.name : null,
      hemiIntensity: c.hemiLight?.intensity ?? null,
      hemiSky: c.hemiLight?.color?.getHexString() ?? null,
      hemiGround: c.hemiLight?.groundColor?.getHexString() ?? null,
      ambientIntensity: c.ambientLight?.intensity ?? null,
      keyIntensity: c.keyLight?.intensity ?? null,
      fillIntensity: c.fillLight?.intensity ?? null,
      lightCount: c.scene
        ? c.scene.children.filter((o) => o.isLight).length
        : null,
      hemiCount: c.scene
        ? c.scene.children.filter((o) => o.isHemisphereLight).length
        : null,
      deviceMetalness: (() => {
        const rack = c.racks?.[0];
        if (!rack) return null;
        const first = [...rack.deviceMaterials.values()][0]?.[0];
        return first ? first.metalness : null;
      })(),
      deviceRoughness: (() => {
        const rack = c.racks?.[0];
        if (!rack) return null;
        const first = [...rack.deviceMaterials.values()][0]?.[0];
        return first ? first.roughness : null;
      })(),
      frameMetalness: c.racks?.[0]?.frameMaterials?.[0]?.metalness ?? null,
      deviceBaseColour: (() => {
        const rack = c.racks?.[0];
        if (!rack) return null;
        const first = [...rack.deviceMaterials.values()][0]?.[0];
        const c2 = first?.userData?.baseColour;
        return c2 ? c2.getHexString() : null;
      })(),
    };
  });
}

/**
 * 画布像素统计：
 *  - modelLuma：非背景像素的平均亮度（衡量"模型整体有多亮"）
 *  - bgLuma：四角背景亮度
 * 用原生分辨率采样 + 以"与清屏色的关系"判定背景，避免细结构被缩放稀释。
 */
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
    const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

    // 取四角平均色当"背景参考色"
    const corners = [
      [2, 2],
      [w - 3, 2],
      [2, h - 3],
      [w - 3, h - 3],
    ];
    let br = 0;
    let bg = 0;
    let bb = 0;
    for (const [x, y] of corners) {
      const p = ctx.getImageData(x, y, 1, 1).data;
      br += p[0];
      bg += p[1];
      bb += p[2];
    }
    br /= corners.length;
    bg /= corners.length;
    bb /= corners.length;

    let modelSum = 0;
    let modelCount = 0;
    let darkSum = 0;
    let darkCount = 0;
    // 设备面板单独统计：面板是"绿色系"（g 明显高于 r/b），
    // 把它从背景 / 地面 / 网格里择出来，才能客观回答"模型材质是不是更亮了"。
    let devSum = 0;
    let devCount = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      const L = luma(r, g, b);
      const greenish = g > r + 8 && g > b + 6 && g > 60;
      if (greenish) {
        devSum += L;
        devCount += 1;
      }
      const dist =
        Math.abs(r - br) + Math.abs(g - bg) + Math.abs(b - bb);
      if (dist < 36) continue; // 背景
      modelSum += L;
      modelCount += 1;
      if (L < 60) {
        darkSum += L;
        darkCount += 1;
      }
    }
    const total = w * h;
    return {
      size: `${c.width}x${c.height}`,
      bgLuma: +luma(br, bg, bb).toFixed(1),
      modelCoverage: +((modelCount / total) * 100).toFixed(2),
      modelLuma: modelCount ? +(modelSum / modelCount).toFixed(1) : null,
      deviceLuma: devCount ? +(devSum / devCount).toFixed(1) : null,
      devicePixelPct: +((devCount / total) * 100).toFixed(2),
      darkPixelPct: +((darkCount / total) * 100).toFixed(2),
      darkPixelMeanLuma: darkCount ? +(darkSum / darkCount).toFixed(1) : null,
    };
  });
}

/** 用引擎只读诊断射线扫描空白点 */
async function findEmptyPoint() {
  return page.evaluate(() => {
    const c = window.__rack3d;
    const canvas = document.querySelector(".rack3d-viewport canvas");
    if (!c || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    for (let gy = 0.05; gy <= 0.95; gy += 0.02) {
      for (let gx = 0.03; gx <= 0.97; gx += 0.01) {
        const cx = rect.left + rect.width * gx;
        const cy = rect.top + rect.height * gy;
        let info = null;
        try {
          info = c.debugProbe(cx, cy);
        } catch {
          info = null;
        }
        const pick = info && info.pick;
        if (pick && pick.rackId === null && !pick.device) {
          return { gx: +gx.toFixed(4), gy: +gy.toFixed(4), cx, cy };
        }
      }
    }
    return null;
  });
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

  // 统一用正视图量亮度（正视图下方正对着设备面板，最能代表"材质亮度"）
  await page.selectOption(".view-select", "front");
  await page.waitForTimeout(1800);

  // ---------- K / L. 环境：无雾 + 半球光 + 材质亮度 ----------
  const base = await engineState();
  const darkStats = await canvasStats();
  results.environment = {
    fog: base?.fog ?? null,
    fogType: base?.fogType ?? null,
    lightCount: base?.lightCount ?? null,
    hemiCount: base?.hemiCount ?? null,
    hemiIntensity: base?.hemiIntensity ?? null,
    hemiSky: base?.hemiSky ?? null,
    hemiGround: base?.hemiGround ?? null,
    ambientIntensity: base?.ambientIntensity ?? null,
    keyIntensity: base?.keyIntensity ?? null,
    fillIntensity: base?.fillIntensity ?? null,
    deviceMetalness: base?.deviceMetalness ?? null,
    deviceRoughness: base?.deviceRoughness ?? null,
    frameMetalness: base?.frameMetalness ?? null,
    theme: base?.theme ?? null,
    darkCanvas: darkStats,
  };
  notes.push("K/L 环境状态: " + JSON.stringify(results.environment));
  await shot("v4-K-env-dark.png");

  // ---------- L4'. A/B 对照：把光照与材质临时改回"改造前"的旧参数 ----------
  // 绝对亮度阈值没有说服力（受相机、主题、设备数量影响），
  // 直接把旧配置在运行期套回去再测一次，用同一台相机、同一场景做同比。
  await page.evaluate(() => {
    const c = window.__rack3d;
    c.ambientLight.intensity = 0.6;
    c.hemiLight.intensity = 2.0;
    c.hemiLight.groundColor.setHex(0x2b313c);
    c.keyLight.intensity = 2.5;
    c.fillLight.intensity = 1.05;
    for (const r of c.racks) {
      for (const m of r.frameMaterials) {
        m.metalness = 0.65;
        m.roughness = 0.55;
      }
      for (const m of r.sideMaterials) m.metalness = 0.3;
      for (const mats of r.deviceMaterials.values()) {
        for (const m of mats) {
          m.metalness = 0.35;
          m.roughness = 0.5;
          const data = m.userData.dataColour;
          if (data) {
            const Color = data.constructor;
            const out = data.clone();
            const lum = 0.2126 * out.r + 0.7152 * out.g + 0.0722 * out.b;
            out.lerp(new Color(lum, lum, lum), 0.85);
            out.lerp(new Color(0.6, 0.6, 0.6), 0.3);
            m.userData.baseColour = out;
          }
        }
      }
    }
    c.setDeviceStatuses(c.lastStatuses ?? {});
  });
  await page.waitForTimeout(1200);
  const legacyStats = await canvasStats();
  await shot("v4-L-legacy-dark.png");

  // 还原：走正式的 setSceneTheme 路径（applyTheme 会重算全部颜色 / 光照 / 状态染色）
  await page.evaluate(() => {
    const c = window.__rack3d;
    c.setSceneTheme(c.theme);
  });
  await page.waitForTimeout(1200);
  const restoredStats = await canvasStats();
  const restored = await engineState();

  results.brightnessAB = {
    legacy: legacyStats,
    current: darkStats,
    restored: restoredStats,
    legacyModelLuma: legacyStats?.modelLuma ?? null,
    currentModelLuma: darkStats?.modelLuma ?? null,
    ratio:
      legacyStats?.modelLuma && darkStats?.modelLuma
        ? +(darkStats.modelLuma / legacyStats.modelLuma).toFixed(3)
        : null,
    legacyDarkPct: legacyStats?.darkPixelPct ?? null,
    currentDarkPct: darkStats?.darkPixelPct ?? null,
    legacyDeviceLuma: legacyStats?.deviceLuma ?? null,
    currentDeviceLuma: darkStats?.deviceLuma ?? null,
    deviceRatio:
      legacyStats?.deviceLuma && darkStats?.deviceLuma
        ? +(darkStats.deviceLuma / legacyStats.deviceLuma).toFixed(3)
        : null,
    restoredMetalness: restored?.deviceMetalness ?? null,
    restoredHemi: restored?.hemiIntensity ?? null,
  };
  notes.push("L4' 新旧参数亮度对比: " + JSON.stringify(results.brightnessAB));

  // ---------- M. 点空白复位后不再跳回聚焦 ----------
  // 1) 重置视角，记录"全场景取景"的 orthoTop 作为基准
  await page.evaluate(() => {
    document.querySelectorAll(".foot-btn").forEach((b) => {
      if (b.textContent?.trim() === "重置视角") b.click();
    });
  });
  await page.waitForTimeout(1800);
  const sceneState = await engineState();
  const sceneTop = sceneState?.orthoTop ?? null;

  // 2) 在 2D 画布选中机柜 → 自动聚焦该柜（orthoTop 明显变小）
  const rackBox = await page.locator(".rack-container").first().boundingBox();
  let zoomedTop = null;
  if (rackBox) {
    for (const ratio of [0.94, 0.79, 0.62]) {
      const x = rackBox.x + rackBox.width / 2;
      const y = rackBox.y + rackBox.height * ratio;
      await page.mouse.click(x, y);
      await page.waitForTimeout(1900);
      const s = await engineState();
      if (s?.selectedRack === "rack-1") {
        zoomedTop = s.orthoTop;
        break;
      }
    }
  }
  await shot("v4-M1-selected-zoomed.png");

  // 3) 点 2D 画布空白 → 应清空选中并**复位到全场景**
  const canvasBox = await page
    .locator('[data-testid="rack-canvas"]')
    .boundingBox();
  if (canvasBox) {
    await page.mouse.click(
      canvasBox.x + 14,
      canvasBox.y + canvasBox.height - 14,
    );
    await page.waitForTimeout(1900);
  }
  const justAfter = await engineState();
  const topJustAfter = justAfter?.orthoTop ?? null;
  await shot("v4-M2-after-empty-click.png");

  // 4) 关键：再等 3 秒，相机**不应**又 tween 回被选中的机柜
  await page.waitForTimeout(3000);
  const settled = await engineState();
  const topSettled = settled?.orthoTop ?? null;
  await shot("v4-M3-settled-3s.png");

  results.resetNoJump = {
    sceneTop,
    zoomedTop,
    topJustAfter:
      topJustAfter === null ? null : +topJustAfter.toFixed(6),
    topAfter3s: topSettled === null ? null : +topSettled.toFixed(6),
    activeRackIdAfterClear: settled?.activeRackId ?? null,
    selectedRack: settled?.selectedRack ?? null,
    selectedDevice: settled?.selectedDevice ?? null,
    resetToScene:
      sceneTop !== null &&
      topSettled !== null &&
      Math.abs(topSettled - sceneTop) < 1e-6,
    didNotJumpBack:
      topJustAfter !== null &&
      topSettled !== null &&
      Math.abs(topSettled - topJustAfter) < 1e-6,
    // 旧 bug 的前置条件仍在（活动机柜没被 2D 空白点清掉），
    // 说明修复来自"聚焦判断只看 selection"，而不是靠副作用"顺手清干净了"
    staleActiveRackStillPresent: settled?.activeRackId === "rack-1",
  };
  notes.push("M 复位不跳回: " + JSON.stringify(results.resetNoJump));

  // ---------- N. 3D 视窗内点空白：清空 + 复位（回归保护） ----------
  // 先在 3D 里选中机柜（用诊断射线找一个命中机柜本体的点）
  const ptRack = await page.evaluate(() => {
    const c = window.__rack3d;
    const canvas = document.querySelector(".rack3d-viewport canvas");
    if (!c || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    for (let gy = 0.05; gy <= 0.95; gy += 0.015) {
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
        if (pick && pick.rackId === "rack-1" && !pick.device) {
          return { gx: +gx.toFixed(4), gy: +gy.toFixed(4), cx, cy };
        }
      }
    }
    return null;
  });
  let rackSelectedTop = null;
  if (ptRack) {
    await page.mouse.click(ptRack.cx, ptRack.cy);
    await page.waitForTimeout(1900);
    rackSelectedTop = (await engineState())?.orthoTop ?? null;
  }
  const ptEmpty = await findEmptyPoint();
  if (ptEmpty) {
    await page.mouse.click(ptEmpty.cx, ptEmpty.cy);
    await page.waitForTimeout(1900);
  }
  const afterEmpty3d = await engineState();
  results.resetVia3dBlank = {
    rackPoint: ptRack,
    emptyPoint: ptEmpty,
    sceneTop,
    rackSelectedTop,
    topAfterEmpty: afterEmpty3d?.orthoTop ?? null,
    selectedRack: afterEmpty3d?.selectedRack ?? null,
    selectedDevice: afterEmpty3d?.selectedDevice ?? null,
    cleared:
      afterEmpty3d?.selectedRack === null &&
      afterEmpty3d?.selectedDevice === null,
    resetToScene:
      sceneTop !== null &&
      afterEmpty3d?.orthoTop != null &&
      Math.abs(afterEmpty3d.orthoTop - sceneTop) < 1e-6,
  };
  notes.push("N 3D 空白复位: " + JSON.stringify(results.resetVia3dBlank));
  await shot("v4-N-3d-blank.png");

  // ---------- O. 亮色主题：同样做新旧参数 A/B（去雾会让亮色主题略微变暗，
  //            必须确认整体亮度没有倒退） ----------
  await page.evaluate(() => {
    document.querySelectorAll(".rack3d-tools .seg-btn").forEach((b) => {
      if (b.textContent?.trim() === "亮色") b.click();
    });
  });
  await page.waitForTimeout(1600);
  const lightState = await engineState();
  const lightStats = await canvasStats();
  await shot("v4-O1-theme-light-new.png");

  // 旧亮色参数
  await page.evaluate(() => {
    const c = window.__rack3d;
    c.ambientLight.intensity = 0.9;
    c.hemiLight.intensity = 1.8;
    c.hemiLight.groundColor.setHex(0xbfc5ce);
    c.keyLight.intensity = 2.1;
    c.fillLight.intensity = 0.85;
    for (const r of c.racks) {
      for (const m of r.frameMaterials) {
        m.metalness = 0.1;
        m.roughness = 0.82;
      }
      for (const m of r.sideMaterials) m.metalness = 0.05;
      for (const mats of r.deviceMaterials.values()) {
        for (const m of mats) {
          m.metalness = 0.06;
          m.roughness = 0.62;
          const data = m.userData.dataColour;
          if (data) {
            const Color = data.constructor;
            const out = data.clone();
            const lum = 0.2126 * out.r + 0.7152 * out.g + 0.0722 * out.b;
            out.lerp(new Color(lum, lum, lum), 0.88);
            out.lerp(new Color(0.84, 0.84, 0.84), 0.3);
            m.userData.baseColour = out;
          }
        }
      }
    }
    c.setDeviceStatuses(c.lastStatuses ?? {});
  });
  await page.waitForTimeout(1200);
  const lightLegacyStats = await canvasStats();
  await shot("v4-O2-theme-light-legacy.png");

  await page.evaluate(() => {
    const c = window.__rack3d;
    c.setSceneTheme(c.theme);
  });
  await page.waitForTimeout(1200);
  const lightRestored = await canvasStats();

  results.lightTheme = {
    theme: lightState?.theme ?? null,
    hemiIntensity: lightState?.hemiIntensity ?? null,
    hemiGround: lightState?.hemiGround ?? null,
    deviceMetalness: lightState?.deviceMetalness ?? null,
    canvas: lightStats,
    legacyCanvas: lightLegacyStats,
    restoredCanvas: lightRestored,
    legacyDeviceLuma: lightLegacyStats?.deviceLuma ?? null,
    currentDeviceLuma: lightStats?.deviceLuma ?? null,
    deviceRatio:
      lightLegacyStats?.deviceLuma && lightStats?.deviceLuma
        ? +(lightStats.deviceLuma / lightLegacyStats.deviceLuma).toFixed(3)
        : null,
    legacyModelLuma: lightLegacyStats?.modelLuma ?? null,
    currentModelLuma: lightStats?.modelLuma ?? null,
    modelRatio:
      lightLegacyStats?.modelLuma && lightStats?.modelLuma
        ? +(lightStats.modelLuma / lightLegacyStats.modelLuma).toFixed(3)
        : null,
  };
  notes.push("O 亮色主题 A/B: " + JSON.stringify(results.lightTheme));

  await page.evaluate(() => {
    document.querySelectorAll(".rack3d-tools .seg-btn").forEach((b) => {
      if (b.textContent?.trim() === "暗色") b.click();
    });
  });
  await page.waitForTimeout(1200);
  await shot("v4-O3-theme-dark-restored.png");

  await page.waitForTimeout(300);
} catch (e) {
  notes.push("FATAL: " + e.message);
} finally {
  await browser.close();
}

// ---------------------------------------------------------------- 判定
const env = results.environment;
const rn = results.resetNoJump;
const r3 = results.resetVia3dBlank;

const checks = {
  // fog 必须真的不存在；同时要求光照对象数量合理，
  // 以防 scene 读取失败时 fog 恒为 null 造成"假通过"
  K_noFog: env?.fog === null && (env?.lightCount ?? 0) >= 4,
  L1_hemisphere:
    env?.hemiCount >= 1 &&
    (env?.hemiIntensity ?? 0) >= 2.5 &&
    env?.hemiGround === "59626f",
  L2_lightsBright: (env?.ambientIntensity ?? 0) >= 0.7 && (env?.fillIntensity ?? 0) >= 1.3,
  L3_materialsMatte:
    (env?.deviceMetalness ?? 1) <= 0.15 && (env?.frameMetalness ?? 1) <= 0.4,
  // 模型平均亮度与"设备面板"亮度都必须明显高于"改造前"（同一相机、同一场景同比）
  L4_modelBrighter: (results.brightnessAB?.ratio ?? 0) >= 1.15,
  L4b_deviceBrighter: (results.brightnessAB?.deviceRatio ?? 0) >= 1.15,
  L5_darkAreasLifted:
    (results.brightnessAB?.currentDarkPct ?? 100) <
      (results.brightnessAB?.legacyDarkPct ?? 0) &&
    (env?.darkCanvas?.darkPixelPct ?? 100) <= 12,
  L6_themeRestorable:
    results.brightnessAB?.restoredMetalness === env?.deviceMetalness &&
    results.brightnessAB?.restoredHemi === env?.hemiIntensity,
  // 亮色主题：去雾会略微压低亮度，但**不能倒退**（设备面板至少与旧参数持平）
  O_lightThemeNotDarker: (results.lightTheme?.deviceRatio ?? 0) >= 1.0,
  M_resetNoJump:
    rn?.resetToScene === true &&
    rn?.didNotJumpBack === true &&
    rn?.staleActiveRackStillPresent === true &&
    rn?.zoomedTop != null &&
    rn?.sceneTop != null &&
    // 必须是"真的推近过"：聚焦单柜的半高应显著小于全场景（双柜场景下约 1/2）
    rn.zoomedTop < rn.sceneTop * 0.75,
  N_3dBlankReset: r3?.cleared === true && r3?.resetToScene === true,
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
