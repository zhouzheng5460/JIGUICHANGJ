/**
 * E2E 运行器：在同一次进程生命期内「起 Vite → 跑探针脚本 → 关 Vite」。
 *
 * 为什么需要它：本机沙箱会在宿主命令结束时回收整棵进程树，
 * 无论是后台任务还是 detached 子进程都活不过单条命令。
 * 把「起服务」和「跑脚本」放进同一个进程组，就不依赖服务常驻。
 *
 * 用法：node tools/e2e.mjs tools/rack3d-verify-v2.mjs
 */

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const [script, ...rest] = process.argv.slice(2);
if (!script) {
  console.error("usage: node tools/e2e.mjs <script.mjs> [args...]");
  process.exit(2);
}

const PORT = process.env.RACK3D_PORT ?? "5173";
const URL = `http://localhost:${PORT}/`;
process.env.RACK3D_URL = URL;

const vite = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "--port", PORT, "--strictPort"],
  {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NO_COLOR: "1" },
  },
);

let viteLog = "";
vite.stdout.on("data", (d) => (viteLog += d.toString()));
vite.stderr.on("data", (d) => (viteLog += d.toString()));
vite.on("exit", (code) => {
  viteLog += `\n[vite exited code=${code}]`;
});

async function waitReady(timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (vite.exitCode !== null) return false;
    try {
      const res = await fetch(URL);
      if (res.ok) return true;
    } catch {
      /* 还没起来 */
    }
    await sleep(400);
  }
  return false;
}

let exitCode = 1;
try {
  const ready = await waitReady();
  if (!ready) {
    console.error("开发服务器未能就绪：\n" + viteLog);
    exitCode = 3;
  } else {
    const child = spawn(process.execPath, [script, ...rest], {
      cwd: process.cwd(),
      stdio: "inherit",
      env: process.env,
    });
    exitCode = await new Promise((resolve) =>
      child.on("exit", (code) => resolve(code ?? 1)),
    );
  }
} finally {
  vite.kill("SIGTERM");
}

process.exitCode = exitCode;
