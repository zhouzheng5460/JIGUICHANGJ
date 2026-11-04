/**
 * 主题对照截图：同一机柜在「暗色 / 亮色」两套主题下各截一张 3D 视口图。
 * 用法：node tools/e2e.mjs tools/shot-theme.mjs
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
const LAYOUT_ID = "shot-theme-0000-4000-8000-000000000001";

const YAML = YAMLNS.default ?? YAMLNS;
const parseYaml = YAML.parse ?? YAMLNS.parse;
const template = parseYaml(
  readFileSync("static/templates/home-lab.rackula.yaml", "utf8"),
);
const UNITS_PER_U = 6;
const placed = (id, slug, name, uPos, face = "front") => ({
  id,
  device_type: slug,
  name,
  position: uPos * UNITS_PER_U,
  face,
});
const R1 = [
  placed("d-firewall", "1u-router-firewall", "边界防火墙", 12),
  placed("d-switch", "24-port-switch", "核心交换机", 11),
  placed("d-patch", "24-port-patch-panel", "配线架", 10),
  placed("d-server-1", "1u-server", "应用服务器", 9),
  placed("d-server-2", "1u-server", "备份服务器", 8),
  placed("d-nas", "4u-storage", "NAS 存储", 4),
  placed("d-ups", "2u-ups", "UPS 电源", 2),
];
const R2 = [
  placed("e-firewall", "1u-router-firewall", "旁路防火墙", 12),
  placed("e-switch", "24-port-switch", "接入交换机", 11),
  placed("e-server", "1u-server", "计算节点", 9),
  placed("e-storage", "4u-storage", "归档存储", 5),
  placed("e-ups", "2u-ups", "UPS 电源", 2),
];
const layout = {
  version: "26.9.0",
  name: "Theme Shot",
  racks: [
    { id: "rack-1", name: "机柜 A / 主柜", height: 12, width: 19, desc_units: false, show_rear: true, form_factor: "4-post-cabinet", starting_unit: 1, position: 0, view: "front", devices: R1 },
    { id: "rack-2", name: "机柜 B / 扩展柜", height: 12, width: 19, desc_units: false, show_rear: true, form_factor: "4-post-cabinet", starting_unit: 1, position: 1, view: "front", devices: R2 },
  ],
  device_types: template.device_types,
  settings: template.settings,
  metadata: { id: LAYOUT_ID, name: "Theme Shot", schema_version: "1.1" },
};
const bindings = [...R1, ...R2].map((d) => ({
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
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({
  viewport: { width: 1680, height: 950 },
  deviceScaleFactor: 2,
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
      localStorage.setItem("rack3d_scene_theme", "dark");
      localStorage.removeItem("rack3d_scene_props");
    },
    { layoutId: LAYOUT_ID, layout, bindings },
  );

  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(7000);
  await page.locator(".rack3d-launcher").first().click({ timeout: 8000 });
  await page.waitForTimeout(5000);

  // 正视图，取景稳定
  await page.selectOption(".view-select", "front");
  await page.waitForTimeout(2000);

  const vp = page.locator(".rack3d-viewport");
  await vp.screenshot({ path: join(OUT, "theme-now-dark.png") });

  await page.evaluate(() => {
    document.querySelectorAll(".rack3d-tools .seg-btn").forEach((b) => {
      if (b.textContent?.trim() === "亮色") b.click();
    });
  });
  await page.waitForTimeout(2000);
  await vp.screenshot({ path: join(OUT, "theme-now-light.png") });

  const info = await page.evaluate(() => {
    const c = window.__rack3d;
    const f = c.racks[0].frameMaterials[0];
    const d = [...c.racks[0].deviceMaterials.values()][0][0];
    return {
      theme: c.theme,
      frame: { hex: f.color.getHexString(), metalness: f.metalness, roughness: f.roughness },
      device: { hex: d.color.getHexString(), metalness: d.metalness, roughness: d.roughness },
    };
  });
  console.log("=== THEME MATERIALS ===\n" + JSON.stringify(info, null, 2));
} catch (e) {
  console.log("FATAL " + e.message);
} finally {
  await browser.close();
}
