/**
 * Rack3D 遥测模拟服务（零依赖）
 * ============================================================================
 * 用途：在没有真实数据采集平台时，提供与"API 服务模拟器"一致的设备数据源，
 *       用于联调 Rack3D 的 REST 适配器与 3D 状态驱动链路。
 *
 * 运行：
 *   node tools/mock-telemetry-server.mjs
 *   node tools/mock-telemetry-server.mjs --port 8787 --count 12
 *
 * 端点：
 *   GET /api/devices          返回全部模拟设备（数组）
 *   GET /api/devices/:id      返回单台设备
 *   GET /api/health           链路健康检查
 *
 * 返回字段（与企划 M3 的 TelemetryFrame 可归一化）：
 *   { id, name, status, power, on, off, temp, rpm, humidity, current, voltage, ts }
 */

import { createServer } from "node:http";

const args = process.argv.slice(2);
const readFlag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const PORT = Number.parseInt(readFlag("port", "8787"), 10);
const COUNT = Number.parseInt(readFlag("count", "12"), 10);

const VENDORS = [
  "Dell PowerEdge R750",
  "HPE ProLiant DL380",
  "Cisco Catalyst 9300",
  "Juniper EX4300",
  "APC Smart-UPS 3000",
  "NetApp FAS2750",
  "Huawei CE6865",
  "Fortinet FG-600F",
  "Lenovo SR650",
  "Supermicro SYS-2029",
];

/** 为每台模拟设备固定一个相位，让曲线平滑且可复现 */
const devices = Array.from({ length: COUNT }, (_, index) => ({
  id: `rack-01-d${String(index + 1).padStart(2, "0")}`,
  name: VENDORS[index % VENDORS.length],
  phase: index * 0.7,
  basePower: 600 + ((index * 137) % 2400),
}));

let tick = 0;

function sample(device) {
  tick += 0.35;
  const wave = Math.sin(tick + device.phase);
  const jitter = (Math.random() - 0.5) * 0.08;
  // 约每 90 秒有一台设备短暂离线，用于验证断链兜底
  const offline = (Math.floor(tick / 3) + Math.round(device.phase)) % 90 === 0;
  const power = Math.max(
    0,
    Math.round(device.basePower * (1 + wave * 0.2 + jitter)),
  );

  return {
    id: device.id,
    name: device.name,
    status: offline ? "offline" : "online",
    power,
    on: !offline,
    off: offline,
    temp: Number((24 + wave * 5 + jitter * 8).toFixed(1)),
    rpm: Math.round(3200 + wave * 1100),
    humidity: Number((44 + wave * 9).toFixed(1)),
    current: Number((power / 220).toFixed(2)),
    voltage: Number((220 + wave * 3).toFixed(1)),
    ts: Date.now(),
  };
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  const send = (status, body) => {
    const payload = JSON.stringify(body, null, 2);
    response.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(payload),
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    });
    response.end(payload);
  };

  if (url.pathname === "/api/health") {
    return send(200, { ok: true, devices: devices.length, tick });
  }

  if (url.pathname === "/api/devices") {
    return send(
      200,
      devices.map((device) => sample(device)),
    );
  }

  const match = /^\/api\/devices\/(.+)$/.exec(url.pathname);
  if (match) {
    const device = devices.find((item) => item.id === match[1]);
    if (!device) return send(404, { error: "device not found" });
    return send(200, sample(device));
  }

  send(404, { error: "not found", endpoints: ["/api/devices", "/api/health"] });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[mock-telemetry] listening on http://127.0.0.1:${PORT}`);
  console.log(`  GET http://127.0.0.1:${PORT}/api/devices`);
  console.log(`  GET http://127.0.0.1:${PORT}/api/health`);
  console.log(`  模拟设备数: ${COUNT}`);
});
