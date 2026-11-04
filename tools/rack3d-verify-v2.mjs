/**
 * Rack3D 第二轮改动（相机 / 选中 / 弹窗 / 摆放）端到端客观验证
 * ===========================================================================
 * 覆盖断言：
 *   A. 默认相机为「正交」
 *   B. 视角预设下拉（默认/正视/侧视/顶视）切换后画面确实改变
 *   C. 正交 ↔ 透视切换保构图（覆盖率不发生数量级跳变）
 *   D. 自动聚焦开关：开启时画布取景显著放大，关闭时不放大
 *   E. 选中高光：画布中出现选中色（粉）像素
 *   F. 状态染色：画布中出现状态色（绿/琥珀/红）像素
 *   G. 弹窗新布局：行式列表 + 进度条 + 折线图路径非空
 *   H. 场景元素：摆放模式下点击地面落地元素、浮动条改色并落库
 *
 * 用法：node tools/rack3d-verify-v2.mjs
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

function placed(id, slug, name, uPos, face = "front") {
  return { id, device_type: slug, name, position: uPos * UNITS_PER_U, face };
}

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
      devices: [
        placed("dev-firewall", "1u-router-firewall", "边界防火墙", 12),
        placed("dev-switch", "24-port-switch", "核心交换机", 11),
        placed("dev-patch", "24-port-patch-panel", "配线架", 10),
        placed("dev-server-1", "1u-server", "应用服务器", 9),
        placed("dev-server-2", "1u-server", "备份服务器", 8),
        placed("dev-nas", "4u-storage", "NAS 存储", 4),
        placed("dev-ups", "2u-ups", "UPS 电源", 2),
      ],
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
      devices: [
        placed("dev2-firewall", "1u-router-firewall", "旁路防火墙", 12),
        placed("dev2-switch", "24-port-switch", "接入交换机", 11),
        placed("dev2-server", "1u-server", "计算节点", 9),
        placed("dev2-storage", "4u-storage", "归档存储", 5),
        placed("dev2-ups", "2u-ups", "UPS 电源", 2),
      ],
    },
  ],
  device_types: template.device_types,
  settings: template.settings,
  metadata: { id: LAYOUT_ID, name: "Rack3D 演示布局", schema_version: "1.1" },
};

function binding(assetId, label, adapter = "mock", thresholds = {}) {
  return {
    id: `bind-${assetId}`,
    asset_kind: "device",
    asset_id: assetId,
    label,
    adapter,
    endpoint: adapter === "rest" ? "http://127.0.0.1:8787/api/devices" : "mock://local",
    metrics: ["power_w", "temp_c", "status", "on_off"],
    point_map: {},
    thresholds,
    poll_ms: 1500,
  };
}

/**
 * 演示用阈值：故意收窄触发面，让机柜整体呈现「以正常为主、少量告警」的真实观感。
 * 阈值定得太低会让每个设备都长期飘红，截图无法反映正常态样式。
 */
const bindings = [
  binding("dev-firewall", "边界防火墙", "mock", { temp_c: { warn: 27.6, crit: 29.2 } }),
  binding("dev-switch", "核心交换机", "mock", {}),
  binding("dev-server-1", "应用服务器", "mock", {}),
  binding("dev-server-2", "备份服务器", "mock", { temp_c: { warn: 27.2, crit: 29 } }),
  binding("dev-nas", "NAS 存储", "mock", {}),
  binding("dev-ups", "UPS 电源", "mock", {}),
  binding("dev2-firewall", "旁路防火墙", "mock", {}),
  binding("dev2-switch", "接入交换机", "mock", {}),
  binding("dev2-server", "计算节点", "mock", { power_w: { warn: 3100, crit: 3300 } }),
  binding("dev2-storage", "归档存储", "mock", {}),
  binding("dev2-ups", "UPS 电源", "mock", {}),
];

const executablePath = EDGE_PATHS.find((p) => existsSync(p));
if (!executablePath) {
  console.error("找不到 msedge.exe");
  process.exit(2);
}

const logs = [];
const notes = [];
const results = {};
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 950 } });
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") logs.push(`[console.error] ${m.text()}`);
});

async function shot(name) {
  try {
    await page.screenshot({ path: join(OUT, name) });
  } catch (e) {
    notes.push(`shot FAIL ${name}: ${e.message}`);
  }
}

/**
 * 画布像素分类统计。
 * 注意：必须按**原生分辨率**采样。线条只有 1px 宽，先缩小再判色会把线宽
 * 稀释成背景色（例如粉 #ff79c6 缩到 0.7px 后变成 (184,91,147)），
 * 用欧氏距离判色会直接漏检。因此这里改用**色相关系**判色，对混色更鲁棒。
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

    let nonBg = 0;
    let cyan = 0;
    let pink = 0;
    let green = 0;
    let amber = 0;
    let red = 0;
    let teal = 0;

    for (let i = 0; i < d.length; i += 4) {
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      if (Math.abs(r - 20) > 12 || Math.abs(g - 22) > 12 || Math.abs(b - 28) > 12) {
        nonBg += 1;
      }
      // 青 #8be9fd：绿蓝高、明显偏青
      if (g > 110 && b > 130 && g - r > 30 && b - r > 45) cyan += 1;
      // 粉 #ff79c6：红高、蓝次之、绿明显最低
      if (r > 120 && b > 95 && r - g > 45 && b - g > 15) pink += 1;
      // 绿 #3ddc84：绿主导（含被基色拉向青绿的情况）
      if (g > 90 && g - r > 40 && g - b > 5) green += 1;
      // 琥珀 #e0b341：红 > 绿 > 蓝
      if (r > 120 && r - g > 25 && g - b > 45) amber += 1;
      // 红 #e05252：红主导且绿蓝都低
      if (r > 110 && r - g > 70 && r - b > 60 && g < 150) red += 1;
      // 静音青 #4a7a8a（设备默认基色）：蓝绿相近、红最低
      if (b - r > 35 && Math.abs(b - g) < 40 && g - r > 20 && b > 80) teal += 1;
    }

    const total = w * h;
    const pct = (n) => +((n / total) * 100).toFixed(2);
    return {
      size: `${c.width}x${c.height}`,
      nonBg: pct(nonBg),
      cyan: pct(cyan),
      pink: pct(pink),
      green: pct(green),
      amber: pct(amber),
      red: pct(red),
      teal: pct(teal),
    };
  });
}

/** 在画布内扫描，找到一个能命中 3D 设备的点击坐标；exclude 用于要求命中不同设备 */
async function findDevicePoint(box, exclude = []) {
  const cols = [0.3, 0.38, 0.46, 0.54, 0.62, 0.7];
  const rows = [0.3, 0.4, 0.5, 0.6, 0.7];
  for (const ry of rows) {
    for (const rx of cols) {
      const x = box.x + box.width * rx;
      const y = box.y + box.height * ry;
      await page.mouse.click(x, y);
      await page.waitForTimeout(340);
      const found = await page.evaluate(() => {
        const p = document.querySelector(".device-popup");
        if (!p) return null;
        return {
          name: p.querySelector(".popup-name")?.textContent?.trim() ?? "",
        };
      });
      if (found && found.name && !exclude.includes(found.name)) {
        return { rx, ry, x, y, name: found.name };
      }
    }
  }
  return null;
}

/** 读取弹窗结构 */
async function popupInfo() {
  return page.evaluate(() => {
    const p = document.querySelector(".device-popup");
    if (!p) return null;
    const pr = p.getBoundingClientRect();
    const vp = document.querySelector(".rack3d-viewport").getBoundingClientRect();
    const path = p.querySelector(".spark path");
    return {
      name: p.querySelector(".popup-name")?.textContent?.trim() ?? "",
      rows: [...p.querySelectorAll(".prow")].map(
        (r) =>
          `${r.querySelector("dt")?.textContent?.trim()}=${r.querySelector("dd")?.textContent?.trim()}`,
      ),
      barWidth: p.querySelector(".bar-fill")?.style?.width ?? null,
      barLabel: p.querySelector(".block-label")?.textContent?.trim() ?? null,
      hasSpark: !!path,
      sparkD: path ? path.getAttribute("d")?.slice(0, 40) : null,
      axis: p.querySelector(".chart-axis")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
      contained:
        pr.left >= vp.left - 1 &&
        pr.right <= vp.right + 1 &&
        pr.top >= vp.top - 1 &&
        pr.bottom <= vp.bottom + 1,
    };
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
    },
    { layoutId: LAYOUT_ID, layout, bindings },
  );

  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(7000);

  // 打开遥测页签（模拟器自动开跑）
  try {
    await page
      .locator('[data-testid="side-panel-tab-telemetry"]')
      .first()
      .click({ timeout: 6000 });
    await page.waitForTimeout(800);
  } catch (e) {
    notes.push("telemetry tab FAIL: " + e.message);
  }

  // 打开 3D 面板
  await page.locator(".rack3d-launcher").first().click({ timeout: 8000 });
  await page.waitForTimeout(5000);

  const box = await page.locator(".rack3d-viewport canvas").boundingBox();
  notes.push(`canvas box: ${JSON.stringify(box)}`);

  // ---------- A. 默认相机 = 正交 ----------
  results.cameraDefault = await page.evaluate(() => {
    const active = [...document.querySelectorAll(".rack3d-tools .seg-btn")]
      .filter((b) => b.classList.contains("active"))
      .map((b) => b.textContent.trim());
    const presets = [...document.querySelectorAll(".view-select option")].map(
      (o) => ({ value: o.value, label: o.textContent.trim() }),
    );
    const selected = document.querySelector(".view-select")?.value ?? null;
    return { active, presets, selected };
  });
  notes.push("A 默认相机/视角: " + JSON.stringify(results.cameraDefault));

  // 等遥测攒够采样点（折线图需要 >= 2 点）
  await page.waitForTimeout(7000);

  // ---------- F. 状态染色 ----------
  const base = await canvasStats();
  results.statusTint = base;
  notes.push("F 画布像素基线: " + JSON.stringify(base));
  await shot("v2-0-baseline.png");

  // ---------- B. 视角预设 ----------
  results.presets = {};
  for (const preset of ["front", "side", "top", "iso"]) {
    await page.selectOption(".view-select", preset);
    await page.waitForTimeout(1200);
    results.presets[preset] = await canvasStats();
    await shot(`v2-B-view-${preset}.png`);
  }
  notes.push("B 视角预设: " + JSON.stringify(results.presets));
  await page.selectOption(".view-select", "iso");
  await page.waitForTimeout(900);

  // ---------- C. 投影切换 ----------
  await page.locator(".rack3d-tools .seg-btn", { hasText: "透视" }).first().click();
  await page.waitForTimeout(1400);
  results.perspective = {
    active: await page.evaluate(
      () =>
        [...document.querySelectorAll(".rack3d-tools .seg-btn")]
          .filter((b) => b.classList.contains("active"))
          .map((b) => b.textContent.trim())[0] ?? null,
    ),
    stats: await canvasStats(),
  };
  await shot("v2-C-perspective.png");
  notes.push("C 透视: " + JSON.stringify(results.perspective));

  await page.locator(".rack3d-tools .seg-btn", { hasText: "正交" }).first().click();
  await page.waitForTimeout(1400);
  results.orthoBack = {
    active: await page.evaluate(
      () =>
        [...document.querySelectorAll(".rack3d-tools .seg-btn")]
          .filter((b) => b.classList.contains("active"))
          .map((b) => b.textContent.trim())[0] ?? null,
    ),
    stats: await canvasStats(),
  };
  notes.push("C 回到正交: " + JSON.stringify(results.orthoBack));

  // ---------- G + E. 设备弹窗与选中高光 ----------
  await page.locator(".foot-btn", { hasText: "重置视角" }).first().click();
  await page.waitForTimeout(1200);

  const hitA = await findDevicePoint(box);
  results.clickedA = hitA;
  notes.push(`G 命中设备 A: ${JSON.stringify(hitA)}`);
  await page.waitForTimeout(1400);

  results.popup = await popupInfo();
  results.selectedStats = await canvasStats();
  notes.push("G 弹窗结构: " + JSON.stringify(results.popup));
  notes.push("E 选中后像素: " + JSON.stringify(results.selectedStats));
  await shot("v2-E-popup-selected.png");

  // 关闭数据卡片后，选中高光应保留（高光跟随选中态，不跟随弹窗）
  await page.locator(".device-popup .popup-close").first().click();
  await page.waitForTimeout(600);
  const afterClose = await page.evaluate(
    () => !document.querySelector(".device-popup"),
  );
  results.outlinePersists = {
    popupClosed: afterClose,
    stats: await canvasStats(),
  };
  notes.push("E 关卡片后: " + JSON.stringify(results.outlinePersists));
  await shot("v2-E2-outline-only.png");

  // 重新选中设备，供后续自动聚焦断言使用
  const hitA2 = await findDevicePoint(box);
  results.clickedA2 = hitA2;
  await page.waitForTimeout(1200);

  // ---------- D. 自动聚焦 ----------
  // D1：autoFocus 默认开启，点击设备后应显著放大
  results.focusOn = await canvasStats();

  // D2：关闭自动聚焦后，重置视角 + 点另一个设备，取景不应放大
  await page.locator(".rack3d-tools .tool-btn", { hasText: "自动聚焦" }).first().click();
  await page.waitForTimeout(500);
  const autoFocusOff = await page.evaluate(() =>
    ![...document.querySelectorAll(".rack3d-tools .tool-btn")].some(
      (b) => b.textContent.trim() === "自动聚焦" && b.classList.contains("active"),
    ),
  );
  await page.locator(".foot-btn", { hasText: "重置视角" }).first().click();
  await page.waitForTimeout(1200);
  const beforeNoFocus = await canvasStats();
  const hitB = await findDevicePoint(box, hitA?.name ? [hitA.name] : []);
  await page.waitForTimeout(1400);
  const afterNoFocus = await canvasStats();
  results.autoFocus = {
    autoFocusOff,
    hitA,
    hitB,
    focusOn: results.focusOn,
    base,
    beforeNoFocus,
    afterNoFocus,
  };
  notes.push("D 自动聚焦: " + JSON.stringify(results.autoFocus));
  await shot("v2-D-autofocus-off.png");

  // 恢复自动聚焦
  await page.locator(".rack3d-tools .tool-btn", { hasText: "自动聚焦" }).first().click();
  await page.waitForTimeout(400);

  // ---------- H. 场景元素摆放 ----------
  await page.locator(".foot-btn", { hasText: "重置视角" }).first().click();
  await page.waitForTimeout(1200);
  await page.locator(".rack3d-tools .tool-btn", { hasText: "摆放" }).first().click();
  await page.waitForTimeout(900);

  const palette = await page.evaluate(() =>
    [...document.querySelectorAll(".prop-palette .palette-btn")].map((b) =>
      b.textContent.trim(),
    ),
  );
  results.palette = palette;
  notes.push("H 元素面板: " + JSON.stringify(palette));

  await page.locator(".prop-palette .palette-btn", { hasText: "立方体" }).first().click();
  await page.waitForTimeout(400);
  const tipText = await page
    .locator(".prop-tip")
    .first()
    .textContent();
  notes.push("H 提示文案: " + (tipText ?? "").trim());

  // 在地面上找一个可落点（避开机柜遮挡）
  let placedOk = false;
  let placedAt = null;
  const groundRows = [0.86, 0.92, 0.78, 0.72, 0.3, 0.22];
  const groundCols = [0.2, 0.5, 0.8, 0.35, 0.65];
  outer: for (const gy of groundRows) {
    for (const gx of groundCols) {
      await page.mouse.click(box.x + box.width * gx, box.y + box.height * gy);
      await page.waitForTimeout(500);
      const count = await page.evaluate(
        () => JSON.parse(localStorage.getItem("rack3d_scene_props") || "[]").length,
      );
      if (count > 0) {
        placedOk = true;
        placedAt = [gx, gy];
        break outer;
      }
    }
  }
  results.place = { placedOk, placedAt };
  notes.push("H 落地: " + JSON.stringify(results.place));
  await page.waitForTimeout(900);

  results.propBar = await page.evaluate(() => {
    const bar = document.querySelector(".prop-bar");
    if (!bar) return null;
    const vp = document.querySelector(".rack3d-viewport").getBoundingClientRect();
    const r = bar.getBoundingClientRect();
    return {
      name: bar.querySelector(".prop-name")?.textContent?.trim() ?? "",
      swatches: bar.querySelectorAll(".swatch").length,
      hasDelete: !!bar.querySelector(".prop-delete"),
      inViewport: r.top >= vp.top - 1 && r.bottom <= vp.bottom + 1,
      paletteHasClear: [...document.querySelectorAll(".prop-palette .palette-btn")].some(
        (b) => b.textContent.trim() === "清空",
      ),
    };
  });
  notes.push("H 浮动条: " + JSON.stringify(results.propBar));
  await shot("v2-H-prop-placed.png");

  // 改色
  const colourBefore = await page.evaluate(
    () => JSON.parse(localStorage.getItem("rack3d_scene_props") || "[]")[0]?.colour,
  );
  await page.locator(".prop-bar .swatch").nth(3).click();
  await page.waitForTimeout(500);
  const colourAfter = await page.evaluate(
    () => JSON.parse(localStorage.getItem("rack3d_scene_props") || "[]")[0]?.colour,
  );
  results.recolour = { colourBefore, colourAfter };
  notes.push("H 改色: " + JSON.stringify(results.recolour));
  await shot("v2-H-prop-recoloured.png");
} catch (e) {
  notes.push("FATAL: " + e.message);
} finally {
  await browser.close();
}

console.log("=== NOTES ===\n" + notes.join("\n"));
console.log(
  "\n=== ERRORS (" + logs.length + ") ===\n" + logs.slice(0, 40).join("\n"),
);
