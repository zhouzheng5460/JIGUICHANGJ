/**
 * 以「脱离父进程」的方式启动 Vite 开发服务器。
 * 直接 Start-Process / 后台任务启动的进程会随宿主 shell 一起被回收，
 * 因此这里用 detached + unref 让 Vite 独立存活。
 *
 * 用法：node tools/dev-server.mjs [port]
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { openSync } from "node:fs";

const port = process.argv[2] ?? "5173";
const cwd = process.cwd();
const logFile = `${process.env.TEMP ?? "."}\\rack3d-dev.log`;
const out = openSync(logFile, "a");

const child = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "--port", port, "--strictPort"],
  {
    cwd,
    detached: true,
    stdio: ["ignore", out, out],
    env: { ...process.env, NO_COLOR: "1" },
  },
);

child.unref();
console.log(`dev server pid=${child.pid} port=${port} log=${logFile}`);
console.log(`vite entry exists: ${existsSync(`${cwd}/node_modules/vite/bin/vite.js`)}`);
