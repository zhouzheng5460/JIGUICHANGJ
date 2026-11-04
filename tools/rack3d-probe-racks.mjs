/**
 * 诊断探针：逐点扫描 3D 画布，统计「哪些设备能被点中并弹出弹窗」。
 * 目的：定位「只有第一个机柜的设备能弹窗」这一现象的真实原因。
 *
 * 用法：node tools/rack3d-probe-racks.mjs
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

const placed = (id, slug, name, uPos, face = "front") => ({
  id,
  device_type: slug,
  name,
  position: uPos * UNITS_PER_U,
  face,
});

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

const bindings = layout.racks.flatMap((rack) =>
  rack.devices.map((d) => ({
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
  })),
);

const executablePath = EDGE_PATHS.find((p) => existsSync(p));
if (!executablePath) {
  console.error("找不到 msedge.exe");
  process.exit(2);
}

const notes = [];
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 950 } });
const errors = [];
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
      localStorage.removeItem("rack3d_scene_props");
    },
    { layoutId: LAYOUT_ID, layout, bindings },
  );

  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(7000);

  await page.locator(".rack3d-launcher").first().click({ timeout: 8000 });
  await page.waitForTimeout(5000);

  // 切正视图：两个机柜左右分开、设备正面朝前，便于按列区分机柜
  await page.selectOption(".view-select", "front");
  await page.waitForTimeout(1500);

  const box = await page.locator(".rack3d-viewport canvas").boundingBox();
  notes.push(`canvas box: ${JSON.stringify(box)}`);

  // 引擎内部诊断：直接看每个机柜在给定屏幕点上被命中了什么
  for (const [rx, ry] of [
    [0.15, 0.5],
    [0.5, 0.5],
    [0.85, 0.5],
  ]) {
    const info = await page.evaluate(
      ({ x, y }) => window.__rack3d?.debugProbe(x, y) ?? null,
      { x: box.x + box.width * rx, y: box.y + box.height * ry },
    );
    notes.push(
      `\n--- debugProbe rx=${rx} ry=${ry} ---\n` + JSON.stringify(info, null, 1),
    );
  }

  const hits = [];
  const cols = [];
  for (let c = 0.06; c <= 0.96; c += 0.03) cols.push(+c.toFixed(2));
  const rows = [0.28, 0.34, 0.4, 0.46, 0.52, 0.58, 0.64, 0.7, 0.76, 0.82];

  for (const ry of rows) {
    for (const rx of cols) {
      const x = box.x + box.width * rx;
      const y = box.y + box.height * ry;
      await page.mouse.click(x, y);
      await page.waitForTimeout(90);
      const found = await page.evaluate(() => {
        const p = document.querySelector(".device-popup");
        return p
          ? {
              name: p.querySelector(".popup-name")?.textContent?.trim() ?? "",
              left: Math.round(p.getBoundingClientRect().left),
            }
          : null;
      });
      if (found?.name) {
        hits.push({ rx, ry, x: Math.round(x), name: found.name, left: found.left });
      }
    }
  }

  notes.push(`命中点总数: ${hits.length}`);
  const byName = new Map();
  for (const h of hits) {
    const entry = byName.get(h.name) ?? { count: 0, minX: h.x, maxX: h.x };
    entry.count += 1;
    entry.minX = Math.min(entry.minX, h.x);
    entry.maxX = Math.max(entry.maxX, h.x);
    byName.set(h.name, entry);
  }
  for (const [name, info] of byName) {
    notes.push(`  ${name}: ${info.count} 点, x∈[${info.minX}, ${info.maxX}]`);
  }

  // 记录每个扫描列是否命中，用于判断「右半区是否完全点不动」
  const colSummary = new Map();
  for (const h of hits) colSummary.set(h.rx, (colSummary.get(h.rx) ?? 0) + 1);
  notes.push(
    "按列命中数: " +
      cols
        .map((c) => `${c}:${colSummary.get(c) ?? 0}`)
        .join(" "),
  );

  const activeRack = await page.evaluate(
    () =>
      document.querySelector(".rack-nav-current")?.textContent?.trim() ??
      document.querySelector('[data-testid="rack-name"]')?.textContent?.trim() ??
      null,
  );
  notes.push(`布局活动机柜: ${activeRack}`);
} catch (e) {
  notes.push("FATAL: " + e.message);
} finally {
  await browser.close();
}

console.log("=== NOTES ===\n" + notes.join("\n"));
console.log("\n=== ERRORS (" + errors.length + ") ===\n" + errors.slice(0, 10).join("\n"));
