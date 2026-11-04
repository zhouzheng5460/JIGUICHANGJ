/**
 * 产品介绍 PPT 出图脚本
 * ===========================================================================
 * 用途：为「机柜3D配置工具」客户版介绍 PPT 抓取真实产品界面截图。
 * 产出目录：由 RACK3D_OUT 指定（默认 verify-out/ppt）。
 *
 * 用法：
 *   node tools/e2e.mjs tools/ppt-shots.mjs
 *   RACK3D_PORT=5200 node tools/e2e.mjs tools/ppt-shots.mjs
 *
 * 说明：复用工程既有 seed 模式（addInitScript 预写 localStorage），
 * 种子布局为「双柜 12 台设备 + 13 条绑定（含柜级）」，mock 适配器零依赖出数据。
 * 界面统一注入「深海蓝」配色方案与客户上传的自定义 LOGO（tools/ppt-logo.svg）。
 */

import { chromium } from "playwright-core";
import * as YAMLNS from "yaml";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const EDGE_PATHS = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const URL = process.env.RACK3D_URL ?? "http://localhost:5173/";
const OUT = process.env.RACK3D_OUT ?? join(process.cwd(), "verify-out", "ppt");
const VW = Number(process.env.RACK3D_VW ?? 1680);
const VH = Number(process.env.RACK3D_VH ?? 950);
/** 1 = 只抓 3D 相关（跳过 2D 总览与数据面板），用于换画幅补拍 */
const ONLY_3D = process.env.RACK3D_ONLY_3D === "1";
const UNITS_PER_U = 6;
const LAYOUT_ID = "ppt-shots-0000-4000-8000-000000000001";
/**
 * 界面配色方案（Settings > 外观）：dracula(经典紫) / ocean(深海蓝)
 * / forest(森林绿) / sunset(落日橙) / mist(晨雾浅色)。
 * PPT 客户版统一用「深海蓝」。
 */
const APP_THEME = process.env.RACK3D_APP_THEME ?? "ocean";
/** 自定义 LOGO：客户上传的 SVG（相对本脚本目录），写入 Rackula_custom_logo */
const LOGO_FILE = process.env.RACK3D_LOGO ?? join(import.meta.dirname, "ppt-logo.svg");
const USE_CUSTOM_LOGO = process.env.RACK3D_NO_LOGO !== "1";

mkdirSync(OUT, { recursive: true });

const customLogoSvg = USE_CUSTOM_LOGO ? readFileSync(LOGO_FILE, "utf8") : null;

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

const R1 = [
  placed("dev-firewall", "1u-router-firewall", "边界防火墙", 12),
  placed("dev-switch", "24-port-switch", "核心交换机", 11),
  placed("dev-patch", "24-port-patch-panel", "配线架", 10),
  placed("dev-server-1", "1u-server", "应用服务器", 9),
  placed("dev-server-2", "1u-server", "备份服务器", 8),
  placed("dev-nas", "4u-storage", "NAS 存储", 4),
  placed("dev-ups", "2u-ups", "UPS 电源", 2),
];
const R2 = [
  placed("dev2-firewall", "1u-router-firewall", "旁路防火墙", 12),
  placed("dev2-switch", "24-port-switch", "接入交换机", 11),
  placed("dev2-server", "1u-server", "计算节点", 9),
  placed("dev2-storage", "4u-storage", "归档存储", 5),
  placed("dev2-ups", "2u-ups", "UPS 电源", 2),
];

const layout = {
  version: "26.9.0",
  name: "机柜3D配置工具 · 演示布局",
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
      devices: R1,
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
      devices: R2,
    },
  ],
  device_types: template.device_types,
  settings: template.settings,
  metadata: {
    id: LAYOUT_ID,
    name: "机柜3D配置工具 · 演示布局",
    schema_version: "1.1",
  },
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

const devBinding = (d, thresholds = {}) => ({
  id: `bind-${d.id}`,
  asset_kind: "device",
  asset_id: d.id,
  label: d.name,
  adapter: "mock",
  endpoint: "mock://local",
  metrics: ALL_8,
  point_map: {},
  thresholds,
  poll_ms: 1500,
});

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
    poll_ms: 1500,
  },
  {
    id: "bind-rack-2",
    asset_kind: "rack",
    asset_id: "rack-2",
    label: "机柜 B 柜级采集",
    adapter: "mock",
    endpoint: "mock://local",
    metrics: ALL_8,
    point_map: {},
    thresholds: {},
    poll_ms: 1500,
  },
  devBinding(R1[0], { temp_c: { warn: 25.5, crit: 27.5 } }),
  devBinding(R1[1]),
  devBinding(R1[2]),
  devBinding(R1[3], { power_w: { warn: 2500, crit: 2750 } }),
  devBinding(R1[4], { temp_c: { warn: 26, crit: 28 } }),
  devBinding(R1[5], { temp_c: { warn: 24.5, crit: 26.5 } }),
  devBinding(R1[6]),
  devBinding(R2[0], { temp_c: { warn: 26, crit: 28 } }),
  devBinding(R2[1]),
  devBinding(R2[2], { power_w: { warn: 2600, crit: 2800 } }),
  devBinding(R2[3], { temp_c: { warn: 25, crit: 27 } }),
  devBinding(R2[4]),
];

const executablePath = EDGE_PATHS.find((p) => existsSync(p));
if (!executablePath) {
  console.error("找不到 msedge.exe");
  process.exit(2);
}

const notes = [];
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({
  viewport: { width: VW, height: VH },
  deviceScaleFactor: 2,
});
const errors = [];
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`[console.error] ${m.text()}`);
});

async function shot(name) {
  try {
    await page.screenshot({ path: join(OUT, name) });
    notes.push(`shot ok: ${name}`);
  } catch (e) {
    notes.push(`shot FAIL ${name}: ${e.message}`);
  }
}

/** 按选择器量出矩形，再按该矩形截图（绕开元素截图对固定定位/浮层的裁切问题） */
async function clipShot(selector, name, pad = 0) {
  try {
    const box = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) return null;
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    }, selector);
    if (!box) {
      notes.push(`clip FAIL ${name}: no box for ${selector}`);
      return;
    }
    const vp = page.viewportSize();
    const x = Math.max(0, box.x - pad);
    const y = Math.max(0, box.y - pad);
    const width = Math.min(vp.width - x, box.width + pad * 2);
    const height = Math.min(vp.height - y, box.height + pad * 2);
    await page.screenshot({ path: join(OUT, name), clip: { x, y, width, height } });
    notes.push(`clip ok: ${name} (${Math.round(width)}x${Math.round(height)})`);
  } catch (e) {
    notes.push(`clip FAIL ${name}: ${e.message}`);
  }
}

/** 点击 3D 面板内任意按钮（按可见文字） */
async function seg(text) {
  try {
    const ok = await page.evaluate((t) => {
      const panel = document.querySelector(".rack3d-panel");
      if (!panel) return false;
      for (const b of panel.querySelectorAll("button")) {
        if ((b.textContent || "").trim() === t) {
          b.click();
          return true;
        }
      }
      return false;
    }, text);
    await page.waitForTimeout(1500);
    notes.push(`seg ${text}: ${ok ? "ok" : "NOT FOUND"}`);
    return ok;
  } catch (e) {
    notes.push(`seg ${text} FAIL: ${e.message}`);
    return false;
  }
}

/** 收起右侧属性面板，让 3D 面板拿到更宽的可视区 */
async function collapseSidePanel() {
  try {
    await page.evaluate(() => {
      document.querySelector(".side-panel-collapse-btn")?.click();
    });
    await page.waitForTimeout(1800);
    const w = await page.evaluate(() => {
      const r = document.querySelector(".rack3d-viewport")?.getBoundingClientRect();
      return r ? `${Math.round(r.width)}x${Math.round(r.height)}` : "none";
    });
    notes.push(`collapse side panel -> 3D viewport ${w}`);
  } catch (e) {
    notes.push("collapse FAIL: " + e.message);
  }
}

/**
 * 在 3D 画布上扫描一个满足条件的坐标并点击。
 * pick 形状：{ rackId, device: { rackId, deviceId } | null }
 * 坐标由引擎算出，不手填比例（视口是竖长条，手填比例会全落在模型外）。
 */
async function clickIn3D(kind) {
  const pt = await page.evaluate((k) => {
    const app = window.__rack3d;
    const c = document.querySelector(".rack3d-viewport canvas");
    if (!app || !c || typeof app.debugProbe !== "function") return null;
    const r = c.getBoundingClientRect();
    for (let gy = 0.06; gy <= 0.94; gy += 0.015) {
      for (let gx = 0.06; gx <= 0.94; gx += 0.01) {
        const cx = r.left + r.width * gx;
        const cy = r.top + r.height * gy;
        const p = app.debugProbe(cx, cy)?.pick;
        if (!p) continue;
        if (k === "device" && p.device?.deviceId) return { cx, cy };
        if (k === "rack" && !p.device && p.rackId) return { cx, cy };
      }
    }
    return null;
  }, kind);
  if (!pt) {
    notes.push(`clickIn3D ${kind}: no point found`);
    return false;
  }
  await page.mouse.click(pt.cx, pt.cy);
  await page.waitForTimeout(2800);
  notes.push(`clickIn3D ${kind}: clicked (${Math.round(pt.cx)},${Math.round(pt.cy)})`);
  return true;
}

/** 关闭全部 3D 弹窗 */
async function closePopups() {
  try {
    await page.evaluate(() => {
      document.querySelectorAll(".popup-close").forEach((b) => b.click());
    });
    await page.waitForTimeout(900);
  } catch {
    /* ignore */
  }
}

try {
  await page.addInitScript(
    ({ layoutId, layout, bindings, appTheme, customLogoSvg }) => {
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
      localStorage.setItem("rack3d_scene_theme", "dark");
      localStorage.removeItem("rack3d_scene_props");
      // 界面配色方案 + 自定义 LOGO（客户上传的 SVG）
      localStorage.setItem("Rackula_app_theme", appTheme);
      if (customLogoSvg) {
        localStorage.setItem("Rackula_custom_logo", customLogoSvg);
      } else {
        localStorage.removeItem("Rackula_custom_logo");
      }
    },
    { layoutId: LAYOUT_ID, layout, bindings, appTheme: APP_THEME, customLogoSvg },
  );

  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  // 首次请求时 Vite 仍在编译依赖，应用启动明显慢于后续热请求。
  // 先等启动器出现，再留出布局渲染与数据注入的时间。
  try {
    await page.waitForSelector(".rack3d-launcher", { timeout: 60000 });
  } catch {
    notes.push("warn: .rack3d-launcher 未在 60s 内出现，继续执行");
  }
  await page.waitForTimeout(8000);

  // ---------- 1) 2D 配置界面（未打开 3D 时先抓）----------
  if (!ONLY_3D) await shot("ppt-00-full-2d.png");

  // ---------- 2) 打开遥测页签，启动采集 ----------
  try {
    await page.evaluate(() => {
      document
        .querySelector('[data-testid="side-panel-tab-telemetry"]')
        ?.click();
    });
    await page.waitForTimeout(1500);
    for (const label of ["启动采集"]) {
      const btn = page.getByRole("button", { name: label });
      if (await btn.count()) await btn.first().click({ timeout: 5000 });
    }
    await page.waitForTimeout(6000);
    notes.push("telemetry started");
  } catch (e) {
    notes.push("telemetry FAIL: " + e.message);
  }
  if (!ONLY_3D)
    await clipShot(
      ".side-panel, aside.side-panel, [data-testid='side-panel']",
      "ppt-13-telemetry-panel.png",
    );

  // ---------- 3) 打开 3D ----------
  await page.locator(".rack3d-launcher").first().click({ timeout: 15000 });
  // 关键：等画布真正挂载，而不是死等固定时长。
  // 首次访问 / 依赖重新预构建时，3D 面板的挂载会明显慢于 7s，固定等待会整段抓空。
  try {
    await page.waitForSelector(".rack3d-viewport canvas", { timeout: 90000 });
    notes.push("3D opened (viewport mounted)");
  } catch (e) {
    notes.push("3D mount TIMEOUT: " + e.message);
  }
  await page.waitForTimeout(7000);

  // 让它多跑几拍，状态色分化
  await page.waitForTimeout(6000);

  // 全屏总览（含 3D，一屏三区）
  if (!ONLY_3D) await shot("ppt-01-overview.png");

  // ---------- 4) 收起右侧属性面板，让 3D 面板拿满宽度 ----------
  await collapseSidePanel();
  await page.waitForTimeout(2500);
  if (!ONLY_3D) await shot("ppt-11-full-wide3d.png");

  // 回到默认全场景取景
  await seg("重置视角");
  await seg("暗色");
  await page.waitForTimeout(2000);
  await clipShot(".rack3d-viewport", "ppt-02-3d-dark.png");

  // 亮色主题
  await seg("亮色");
  await page.waitForTimeout(2000);
  await clipShot(".rack3d-viewport", "ppt-03-3d-light.png");

  // 回暗色 + 线框
  await seg("暗色");
  await seg("线框");
  await clipShot(".rack3d-viewport", "ppt-04-3d-wireframe.png");

  // 透视（看穿柜体）
  await seg("透视");
  await clipShot(".rack3d-viewport", "ppt-05-3d-xray.png");

  // 回实体
  await seg("实体");
  await page.waitForTimeout(1500);

  // 顶视图（工程读数）
  try {
    await page.selectOption(".view-select", "top");
    await page.waitForTimeout(2800);
    await clipShot(".rack3d-viewport", "ppt-06-3d-top.png");
    await page.selectOption(".view-select", "iso");
    await page.waitForTimeout(2500);
  } catch (e) {
    notes.push("view-select FAIL: " + e.message);
  }

  // ---------- 5) 设备弹窗（指标 + 进度条 + 趋势图）----------
  await clickIn3D("device");
  await clipShot(".rack3d-viewport", "ppt-07-device-popup.png");
  await shot("ppt-08-device-popup-full.png");
  await closePopups();
  await page.waitForTimeout(1500);

  // ---------- 6) 机柜弹窗（柜级绑定）----------
  await clickIn3D("rack");
  await clipShot(".rack3d-viewport", "ppt-09-rack-popup.png");
  await closePopups();

  // ---------- 7) 工具条特写 ----------
  await page.waitForTimeout(1500);
  await clipShot(".rack3d-tools", "ppt-10-3d-toolbar.png", 10);

  const state = await page.evaluate(() => {
    const c = document.querySelector(".rack3d-viewport canvas");
    return {
      canvas: c ? `${c.width}x${c.height} css=${c.clientWidth}x${c.clientHeight}` : "none",
      theme: window.__rack3d?.theme ?? null,
      racks: window.__rack3d?.racks?.length ?? null,
      bodyLen: (document.body.innerText || "").length,
      rects: {
        viewport: (() => {
          const r = document.querySelector(".rack3d-viewport")?.getBoundingClientRect();
          return r ? [Math.round(r.width), Math.round(r.height)] : null;
        })(),
      },
    };
  });
  notes.push("STATE " + JSON.stringify(state));
} catch (e) {
  notes.push("FATAL: " + e.message + "\n" + e.stack);
} finally {
  await browser.close();
}

console.log("=== NOTES ===\n" + notes.join("\n"));
console.log("\n=== OUT DIR === " + OUT);
console.log("\n=== ERRORS (" + errors.length + ") ===\n" + errors.slice(0, 25).join("\n"));
