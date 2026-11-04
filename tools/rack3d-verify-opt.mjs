/**
 * Rack3D 三项优化点的端到端客观验证
 * ---------------------------------------------------------------------------
 * 1. 弹窗/按钮配色统一（不再出现告警红 #e05252 描边与关闭按钮）
 * 2. 三种渲染模式切换（实体 / 线框 / 透视）—— 用「青色线框像素数」客观量化
 * 3. 点击 3D 设备 → 弹出三维内二维数据卡片，显示实时指标，且随相机移动
 *
 * 用法：node tools/rack3d-verify-opt.mjs
 * 环境变量：RACK3D_URL / RACK3D_OUT
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

function binding(assetId, label, thresholds = {}) {
  return {
    id: `bind-${assetId}`,
    asset_kind: "device",
    asset_id: assetId,
    label,
    adapter: "mock",
    endpoint: "mock://local",
    metrics: ["power_w", "temp_c", "status", "on_off"],
    point_map: {},
    thresholds,
    poll_ms: 2000,
  };
}

const bindings = [
  binding("dev-firewall", "边界防火墙", { temp_c: { warn: 25.5, crit: 27.5 } }),
  binding("dev-switch", "核心交换机", {}),
  binding("dev-server-1", "应用服务器", { power_w: { warn: 2500, crit: 2750 } }),
  binding("dev-server-2", "备份服务器", { temp_c: { warn: 26, crit: 28 } }),
  binding("dev-nas", "NAS 存储", { temp_c: { warn: 24.5, crit: 26.5 } }),
  binding("dev-ups", "UPS 电源", {}),
  binding("dev2-firewall", "旁路防火墙", { temp_c: { warn: 26, crit: 28 } }),
  binding("dev2-switch", "接入交换机", {}),
  binding("dev2-server", "计算节点", { power_w: { warn: 2600, crit: 2800 } }),
  binding("dev2-storage", "归档存储", { temp_c: { warn: 25, crit: 27 } }),
  binding("dev2-ups", "UPS 电源", {}),
];

const executablePath = EDGE_PATHS.find((p) => existsSync(p));
if (!executablePath) {
  console.error("找不到 msedge.exe");
  process.exit(2);
}

const logs = [];
const notes = [];
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 950 } });
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") logs.push(`[console.error] ${m.text()}`);
});

async function shot(name) {
  try {
    await page.screenshot({ path: join(OUT, name) });
    notes.push(`shot ok: ${name}`);
  } catch (e) {
    notes.push(`shot FAIL ${name}: ${e.message}`);
  }
}

/** 统计 3D 画布像素特征：非背景占比 + 青色（线框 0x8be9fd）像素占比 */
async function canvasStats() {
  return page.evaluate(() => {
    const c = document.querySelector(".rack3d-viewport canvas");
    if (!c || !c.width) return null;
    const tmp = document.createElement("canvas");
    tmp.width = 240;
    tmp.height = 480;
    const ctx = tmp.getContext("2d");
    ctx.drawImage(c, 0, 0, tmp.width, tmp.height);
    const d = ctx.getImageData(0, 0, tmp.width, tmp.height).data;
    let nonBg = 0;
    let cyan = 0;
    let opaqueFrame = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      if (Math.abs(r - 20) > 12 || Math.abs(g - 22) > 12 || Math.abs(b - 28) > 12)
        nonBg += 1;
      // 线框青：蓝绿高、明显偏青
      if (b > 170 && g > 160 && b - r > 45) cyan += 1;
      // 机柜框架灰 #59606e ≈ (89,96,110)
      if (Math.abs(r - 89) < 34 && Math.abs(g - 96) < 34 && Math.abs(b - 110) < 34)
        opaqueFrame += 1;
    }
    const total = tmp.width * tmp.height;
    return {
      nonBg: +((nonBg / total) * 100).toFixed(2),
      cyan: +((cyan / total) * 100).toFixed(2),
      frame: +((opaqueFrame / total) * 100).toFixed(2),
    };
  });
}

const RED = "rgb(224, 82, 82)"; // #e05252 告警红
const RED_RGB = [224, 82, 82];
function isRed(css) {
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(css || "");
  if (!m) return false;
  return (+m[1] === RED_RGB[0] && +m[2] === RED_RGB[1] && +m[3] === RED_RGB[2]);
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
    },
    { layoutId: LAYOUT_ID, layout, bindings },
  );

  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(8000);

  // --- 启动遥测采集，让设备有实时数据 ---
  try {
    await page
      .locator('[data-testid="side-panel-tab-telemetry"]')
      .first()
      .click({ timeout: 8000 });
    await page.waitForTimeout(1000);
    const btn = page.getByRole("button", { name: "启动采集" });
    if (await btn.count()) {
      await btn.first().click({ timeout: 5000 });
      notes.push("telemetry started");
    }
  } catch (e) {
    notes.push("telemetry start FAIL: " + e.message);
  }

  // --- 打开 3D 视图 ---
  await page.locator(".rack3d-launcher").first().click({ timeout: 8000 });
  await page.waitForTimeout(5000);
  notes.push("3D opened");

  // ============ 优化点 1：配色统一 ============
  const colours = await page.evaluate(() => {
    const g = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { color: cs.color, border: cs.borderTopColor, bg: cs.backgroundColor };
    };
    return {
      panel: g(".rack3d-panel"),
      title: g(".rack3d-title"),
      close: g(".rack3d-close"),
      head: g(".rack3d-head"),
      foot: g(".rack3d-foot"),
      mode: g(".mode-btn"),
      launcherExists: !!document.querySelector(".rack3d-launcher"),
    };
  });
  notes.push("COLOURS: " + JSON.stringify(colours));
  notes.push(
    "OPT1 panelBorderIsRed=" +
      isRed(colours.panel?.border) +
      " titleIsRed=" +
      isRed(colours.title?.color) +
      " closeIsRed=" +
      isRed(colours.close?.color),
  );
  await shot("opt-1-colours.png");

  // ============ 优化点 2：三种渲染模式 ============
  const modes = await page.$$eval(".rack3d-modes .mode-btn", (els) =>
    els.map((e) => ({
      label: e.textContent.trim(),
      active: e.classList.contains("active"),
      title: e.getAttribute("title"),
    })),
  );
  notes.push("MODES: " + JSON.stringify(modes));

  const modeStats = {};
  const seq = [
    ["实体", "solid"],
    ["线框", "wireframe"],
    ["透视", "xray"],
  ];
  for (const [label, key] of seq) {
    await page
      .locator(".rack3d-modes .mode-btn", { hasText: label })
      .first()
      .click({ timeout: 6000 });
    await page.waitForTimeout(1600);
    modeStats[key] = await canvasStats();
    const activeNow = await page.$$eval(".rack3d-modes .mode-btn", (els) =>
      els.filter((e) => e.classList.contains("active")).map((e) => e.textContent.trim()),
    );
    notes.push(`mode ${key} active=${JSON.stringify(activeNow)} stats=${JSON.stringify(modeStats[key])}`);
    await shot(`opt-2-mode-${key}.png`);
  }

  // 回到实体模式做点击验证
  await page
    .locator(".rack3d-modes .mode-btn", { hasText: "实体" })
    .first()
    .click({ timeout: 6000 });
  await page.waitForTimeout(1200);

  // ============ 优化点 3：点击设备 → 二维数据卡片 ============
  const box = await page.locator(".rack3d-viewport canvas").boundingBox();
  let found = null;
  const cols = [0.34, 0.42, 0.5, 0.58, 0.66];
  const rows = [0.3, 0.4, 0.5, 0.6, 0.7];
  outer: for (const ry of rows) {
    for (const rx of cols) {
      const x = box.x + box.width * rx;
      const y = box.y + box.height * ry;
      await page.mouse.click(x, y);
      await page.waitForTimeout(350);
      const info = await page.evaluate(() => {
        const p = document.querySelector(".device-popup");
        if (!p) return null;
        const cs = getComputedStyle(p);
        const pr = p.getBoundingClientRect();
        const vp = document
          .querySelector(".rack3d-viewport")
          .getBoundingClientRect();
        return {
          text: p.innerText.replace(/\n+/g, " | "),
          left: cs.left,
          top: cs.top,
          below: p.classList.contains("below"),
          hasMetrics: !!p.querySelector(".popup-metrics"),
          metricRows: p.querySelectorAll(".metric-row").length,
          hasLinkBadge: !!p.querySelector(".link-badge"),
          border: cs.borderTopColor,
          // 卡片是否完整落在 3D 视口内（不被 overflow 裁切）
          contained:
            pr.left >= vp.left - 1 &&
            pr.right <= vp.right + 1 &&
            pr.top >= vp.top - 1 &&
            pr.bottom <= vp.bottom + 1,
          rect: [pr.left, pr.top, pr.width, pr.height].map((n) => Math.round(n)),
          viewport: [vp.left, vp.top, vp.width, vp.height].map((n) =>
            Math.round(n),
          ),
        };
      });
      if (info) {
        found = { at: [+rx.toFixed(2), +ry.toFixed(2)], ...info };
        break outer;
      }
    }
  }
  notes.push("PICK RESULT: " + JSON.stringify(found));
  await shot("opt-3-popup.png");

  // 弹窗随相机移动
  if (found) {
    const before = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector(".device-popup"));
      return { left: cs.left, top: cs.top };
    });
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(
        box.x + box.width * 0.5 + i * 14,
        box.y + box.height * 0.5 + i * 6,
      );
      await page.waitForTimeout(40);
    }
    await page.mouse.up();
    await page.waitForTimeout(900);
    const after = await page.evaluate(() => {
      const el = document.querySelector(".device-popup");
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { left: cs.left, top: cs.top };
    });
    notes.push(
      `POPUP FOLLOWS CAMERA: before=${JSON.stringify(before)} after=${JSON.stringify(after)} moved=${after && (after.left !== before.left || after.top !== before.top)}`,
    );
    await shot("opt-3-popup-after-orbit.png");

    // 透视模式下的穿透拾取
    await page
      .locator(".rack3d-modes .mode-btn", { hasText: "透视" })
      .first()
      .click({ timeout: 6000 });
    await page.waitForTimeout(1500);
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.waitForTimeout(500);
    const xrayPick = await page.evaluate(
      () => !!document.querySelector(".device-popup"),
    );
    notes.push("XRAY PICK (see-through): popupPresent=" + xrayPick);
    await shot("opt-3-xray-pick.png");

    // 关闭按钮
    const closeBtn = page.locator(".device-popup .popup-close");
    if (await closeBtn.count()) {
      await closeBtn.first().click({ timeout: 5000 });
      await page.waitForTimeout(400);
      const gone = await page.evaluate(
        () => !document.querySelector(".device-popup"),
      );
      notes.push("POPUP CLOSE works=" + gone);
    }
  }
} catch (e) {
  notes.push("FATAL: " + e.message);
} finally {
  await browser.close();
}

console.log("=== NOTES ===\n" + notes.join("\n"));
console.log("\n=== ERRORS (" + logs.length + ") ===\n" + logs.slice(0, 40).join("\n"));
