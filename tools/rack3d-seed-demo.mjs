/**
 * Rack3D 演示数据注入 —— 让 3D 机柜查看模块有真实设备可渲染
 * ===========================================================================
 * 做两件事：
 *   1. 把 static/templates/home-lab.rackula.yaml（单柜 7 台设备）扩成双柜布局，
 *      按 **内部单位 1/6U** 写入 localStorage（YAML 模板用的是旧版 U 单位，须 ×6）
 *      并同步写 Rackula:workspace 索引
 *   2. 预置遥测绑定（mock 适配器），使「链路状态」与「遥测着色」有数据可跑
 *
 * 用法：node tools/rack3d-seed-demo.mjs
 */

import { chromium } from "playwright-core";
import * as YAMLNS from "yaml";
import { existsSync, readFileSync } from "node:fs";

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

/** 构造一个已放置设备；uPos 用人类可读的 U 位，内部自动 ×6 */
function placed(id, slug, name, uPos, face = "front") {
  return {
    id,
    device_type: slug,
    name,
    position: uPos * UNITS_PER_U,
    face,
  };
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
  metadata: {
    id: LAYOUT_ID,
    name: "Rack3D 演示布局",
    schema_version: "1.1",
  },
};

/** mock 适配器生成：temp_c≈24±4、power_w≈1800-2900、on_off/status 随波 */
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
  binding("dev-firewall", "边界防火墙", {
    temp_c: { warn: 25.5, crit: 27.5 },
  }),
  binding("dev-switch", "核心交换机", {}),
  binding("dev-server-1", "应用服务器", {
    power_w: { warn: 2500, crit: 2750 },
  }),
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
    await page.screenshot({ path: `${OUT}\\${name}` });
    notes.push(`shot ok: ${name}`);
  } catch (e) {
    notes.push(`shot FAIL ${name}: ${e.message}`);
  }
}

/** 读回存储与画布，确认布局/绑定真的装进去了 */
async function countPlaced() {
  return page.evaluate(() => {
    const ws = JSON.parse(localStorage.getItem("Rackula:workspace") || "{}");
    const body = localStorage.getItem(`Rackula:layout:${ws.activeId}`) || "";
    let layoutName = "(none)";
    let deviceCount = -1;
    try {
      const parsed = JSON.parse(body);
      layoutName = parsed?.layout?.name ?? "(no name)";
      deviceCount = (parsed?.layout?.racks ?? []).reduce(
        (n, r) => n + (r.devices?.length ?? 0),
        0,
      );
    } catch {
      layoutName = "(unparsable)";
    }
    let bindingCount = -1;
    try {
      bindingCount = JSON.parse(
        localStorage.getItem("rack3d_telemetry_bindings") || "[]",
      ).length;
    } catch {
      bindingCount = -1;
    }
    const text = document.body.innerText || "";
    return {
      activeId: ws.activeId,
      layoutName,
      deviceCount,
      bindingCount,
      mentions: [
        "边界防火墙",
        "核心交换机",
        "NAS 存储",
        "UPS 电源",
        "计算节点",
        "归档存储",
      ].filter((t) => text.includes(t)),
    };
  });
}

try {
  // 关键：必须用 addInitScript 在应用脚本运行前写入 localStorage。
  // 若先 goto 再 setItem 然后 reload，旧页面在卸载时会把自己的状态回写，
  // 把注入的数据覆盖掉。
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
      localStorage.setItem(
        "rack3d_telemetry_bindings",
        JSON.stringify(bindings),
      );
    },
    { layoutId: LAYOUT_ID, layout, bindings },
  );

  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(9000);

  notes.push("after seed: " + JSON.stringify(await countPlaced()));

  // 客观探针：属性翻译（placeholder / title / aria-label）是否生效
  const i18nProbe = await page.evaluate(() => {
    const input = document.querySelector("input[placeholder]");
    const text = document.body.innerText || "";
    return {
      placeholder: input ? input.getAttribute("placeholder") : "(no input)",
      titles: Array.from(document.querySelectorAll("[title]"))
        .slice(0, 6)
        .map((e) => e.getAttribute("title")),
      ariaLabels: Array.from(document.querySelectorAll("[aria-label]"))
        .slice(0, 8)
        .map((e) => e.getAttribute("aria-label")),
      stillEnglish: [
        "full-depth devices yet",
        "Search devices",
        "Not exported",
        "Drag one in",
      ].filter((t) => text.includes(t)),
    };
  });
  notes.push("I18N PROBE: " + JSON.stringify(i18nProbe));

  await shot("demo-1-2d-layout.png");

  // --- 打开遥测页签并启动采集 ---
  try {
    await page
      .locator('[data-testid="side-panel-tab-telemetry"]')
      .first()
      .click({ timeout: 8000 });
    await page.waitForTimeout(1200);
    notes.push("telemetry tab ok");
  } catch (e) {
    notes.push("telemetry tab FAIL: " + e.message);
  }

  for (const label of ["启动采集"]) {
    try {
      const btn = page.getByRole("button", { name: label });
      if (await btn.count()) {
        await btn.first().click({ timeout: 5000 });
        notes.push(`clicked ${label}`);
      } else {
        notes.push(`button not found: ${label}`);
      }
    } catch (e) {
      notes.push(`click ${label} FAIL: ${e.message}`);
    }
  }
  await page.waitForTimeout(6000);
  await shot("demo-2-telemetry-live.png");

  // --- 打开 3D 机柜查看 ---
  // 注意：aria-label 会被汉化词典层翻译，不能再按英文 aria-label 定位，用类名更稳。
  try {
    await page.locator(".rack3d-launcher").first().click({ timeout: 8000 });
    await page.waitForTimeout(6000);
    notes.push("3D opened");
  } catch (e) {
    notes.push("3D open FAIL: " + e.message);
  }

  const canvasInfo = await page.evaluate(() => {
    const c = document.querySelector(".rack3d-viewport canvas");
    if (!c) return "no canvas";
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    return `canvas ${c.width}x${c.height} ctx=${gl ? "ok" : "none"} css=${c.clientWidth}x${c.clientHeight}`;
  });
  notes.push("3D canvas: " + canvasInfo);
  await shot("demo-3-3d.png");

  // 客观探针 1：识别 2D 画布上面板标签到底渲染成了什么
  const labels = await page.evaluate(() => {
    const wanted = ["正面", "背面", "正常", "Front", "Rear", "正面/背面"];
    const hits = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    let node;
    while ((node = walker.nextNode())) {
      const t = (node.textContent || "").trim();
      if (wanted.includes(t)) {
        const el = node.parentElement;
        hits.push({
          text: t,
          tag: el?.tagName,
          cls: String(el?.className ?? "").slice(0, 50),
        });
      }
    }
    return hits.slice(0, 20);
  });
  notes.push("LABEL PROBE: " + JSON.stringify(labels));

  // 客观探针 2：统计 3D 画布非背景像素占比，确认场景真的画出了东西
  const coverage = await page.evaluate(() => {
    const c = document.querySelector(".rack3d-viewport canvas");
    if (!c || !c.width) return "no canvas";
    const tmp = document.createElement("canvas");
    tmp.width = 160;
    tmp.height = 320;
    const ctx = tmp.getContext("2d");
    ctx.drawImage(c, 0, 0, tmp.width, tmp.height);
    const d = ctx.getImageData(0, 0, tmp.width, tmp.height).data;
    let nonBg = 0;
    let bright = 0;
    for (let i = 0; i < d.length; i += 4) {
      const dr = Math.abs(d[i] - 20);
      const dg = Math.abs(d[i + 1] - 22);
      const db = Math.abs(d[i + 2] - 28);
      if (dr > 12 || dg > 12 || db > 12) nonBg += 1;
      if (d[i] + d[i + 1] + d[i + 2] > 260) bright += 1;
    }
    const total = tmp.width * tmp.height;
    return `nonBg=${((nonBg / total) * 100).toFixed(1)}% bright=${((bright / total) * 100).toFixed(1)}%`;
  });
  notes.push("3D coverage: " + coverage);

  // 等 mock 多跑几拍，让状态色出现分化
  await page.waitForTimeout(9000);
  await shot("demo-4-3d-telemetry.png");

  const coverage2 = await page.evaluate(() => {
    const c = document.querySelector(".rack3d-viewport canvas");
    if (!c || !c.width) return "no canvas";
    const tmp = document.createElement("canvas");
    tmp.width = 160;
    tmp.height = 320;
    const ctx = tmp.getContext("2d");
    ctx.drawImage(c, 0, 0, tmp.width, tmp.height);
    const d = ctx.getImageData(0, 0, tmp.width, tmp.height).data;
    let nonBg = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (
        Math.abs(d[i] - 20) > 12 ||
        Math.abs(d[i + 1] - 22) > 12 ||
        Math.abs(d[i + 2] - 28) > 12
      )
        nonBg += 1;
    }
    return `nonBg=${((nonBg / (tmp.width * tmp.height)) * 100).toFixed(1)}%`;
  });
  notes.push("3D coverage after telemetry: " + coverage2);
} catch (e) {
  notes.push("FATAL: " + e.message);
} finally {
  await browser.close();
}

console.log("=== NOTES ===\n" + notes.join("\n"));
console.log("\n=== ERRORS (" + logs.length + ") ===\n" + logs.slice(0, 40).join("\n"));
