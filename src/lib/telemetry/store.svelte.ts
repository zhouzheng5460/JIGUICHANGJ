/**
 * Rack3D 遥测数据 store
 * ============================================================================
 * 职责：
 *   1. 维护"资产 ↔ 采集来源"的绑定关系（持久化到 localStorage）；
 *   2. 运行适配器（当前提供 REST 轮询与本地模拟器两种，二者输出同一套
 *      TelemetryFrame，验证企划 3.1 的适配器隔离设计）；
 *   3. 提供按资产查询当前帧、数据质量与链路健康度的读取接口。
 *
 * 扩展新平台：新增一个 poll* 函数并注册到 ADAPTER_RUNNERS 即可，
 * 不需要改动面板与 3D 层——这正是企划 M5"适配器插件化"的落地形式。
 */

import { safeGetItem, safeSetItem } from "$lib/utils/safe-storage";
import {
  DEFAULT_POLL_MS,
  STALE_AFTER_MS,
  type AdapterType,
  type BindingRuntime,
  type FrameQuality,
  type LinkState,
  type MetricKey,
  type TelemetryBinding,
  type TelemetryFrame,
} from "./types";

const STORAGE_KEY = "rack3d_telemetry_bindings";

function loadBindings(): TelemetryBinding[] {
  const raw = safeGetItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TelemetryBinding[]) : [];
  } catch {
    return [];
  }
}

function persist(): void {
  try {
    safeSetItem(STORAGE_KEY, JSON.stringify(bindings));
  } catch {
    // 持久化失败不影响实时链路
  }
}

// ---------------------------------------------------------------- 状态
let bindings = $state<TelemetryBinding[]>(loadBindings());
let frames = $state<Record<string, TelemetryFrame>>({});
let runtimes = $state<Record<string, BindingRuntime>>({});
let started = $state(false);

/**
 * 指标历史环形缓冲：asset_id → 指标 → 最近若干采样点。
 * 只保留数值型指标（折线图用），不落盘——历史属于"会话级观察窗口"。
 */
const HISTORY_LIMIT = 48;
let history = $state<Record<string, Partial<Record<MetricKey, number[]>>>>({});

/** 绑定 id → 定时器 */
const timers = new Map<string, ReturnType<typeof setInterval>>();

// ---------------------------------------------------------------- 归一化
/** 采集平台常用字段别名 → 标准指标（对接 API 服务模拟器的 name/id/status/power/on-off） */
const ALIASES: Record<string, MetricKey> = {
  power: "power_w",
  power_w: "power_w",
  powerw: "power_w",
  watts: "power_w",
  current: "current_a",
  current_a: "current_a",
  amp: "current_a",
  voltage: "voltage_v",
  voltage_v: "voltage_v",
  temp: "temp_c",
  temp_c: "temp_c",
  temperature: "temp_c",
  humidity: "humidity",
  rh: "humidity",
  status: "status",
  state: "status",
  rpm: "rpm",
  fan_rpm: "rpm",
  on: "on_off",
  on_off: "on_off",
  switch: "on_off",
  power_state: "on_off",
};

function coerceNumeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.replace(/[^\d.+-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function coerceBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["true", "on", "1", "yes", "y", "开", "开启"].includes(v)) return true;
    if (["false", "off", "0", "no", "n", "关", "关闭"].includes(v)) return false;
  }
  return null;
}

/** 数值型指标的集合，用于类型收敛 */
const NUMERIC: ReadonlySet<MetricKey> = new Set<MetricKey>([
  "power_w",
  "current_a",
  "voltage_v",
  "temp_c",
  "humidity",
  "rpm",
]);

/**
 * 把采集平台的原始对象归一化为标准指标。
 * 优先按绑定的 point_map 映射，其次按字段别名自动识别。
 */
export function normalizeMetrics(
  raw: Record<string, unknown>,
  pointMap: Record<string, MetricKey>,
): Partial<Record<MetricKey, number | string | boolean>> {
  const out: Partial<Record<MetricKey, number | string | boolean>> = {};

  const assign = (metric: MetricKey, value: unknown): void => {
    if (value === undefined || value === null) return;
    if (metric === "on_off") {
      const b = coerceBoolean(value);
      if (b !== null) out[metric] = b;
      return;
    }
    if (NUMERIC.has(metric)) {
      const n = coerceNumeric(value);
      if (n !== null) out[metric] = n;
      return;
    }
    out[metric] = String(value);
  };

  // 1) 显式点位映射优先
  for (const [point, metric] of Object.entries(pointMap ?? {})) {
    if (point in raw) assign(metric, raw[point]);
  }

  // 2) 别名自动识别兜底
  for (const [key, value] of Object.entries(raw)) {
    const metric = ALIASES[key.toLowerCase()];
    if (!metric) continue;
    if (out[metric] !== undefined) continue;
    assign(metric, value);
  }

  return out;
}

// ---------------------------------------------------------------- 运行态
function ensureRuntime(bindingId: string): BindingRuntime {
  if (!runtimes[bindingId]) {
    runtimes[bindingId] = {
      state: "idle",
      lastFrameTs: null,
      failures: 0,
    };
  }
  return runtimes[bindingId];
}

function commitFrame(
  binding: TelemetryBinding,
  metrics: TelemetryFrame["metrics"],
  raw?: unknown,
  quality: FrameQuality = "good",
): void {
  const frame: TelemetryFrame = {
    asset_id: binding.asset_id,
    ts: Date.now(),
    metrics,
    quality,
    raw,
  };
  frames = { ...frames, [binding.asset_id]: frame };

  // 记录数值型指标历史（供弹窗折线图使用）
  const nextHistory: Partial<Record<MetricKey, number[]>> = {
    ...(history[binding.asset_id] ?? {}),
  };
  let touched = false;
  for (const [key, value] of Object.entries(metrics)) {
    if (typeof value !== "number") continue;
    const metric = key as MetricKey;
    const series = [...(nextHistory[metric] ?? []), value];
    nextHistory[metric] = series.slice(-HISTORY_LIMIT);
    touched = true;
  }
  if (touched) history = { ...history, [binding.asset_id]: nextHistory };

  const runtime = ensureRuntime(binding.id);
  runtime.state = quality === "good" ? "live" : "degraded";
  runtime.lastFrameTs = frame.ts;
  runtime.error = undefined;
  runtime.failures = 0;
}

function reportFailure(binding: TelemetryBinding, error: unknown): void {
  const runtime = ensureRuntime(binding.id);
  runtime.failures += 1;
  runtime.error = error instanceof Error ? error.message : String(error);
  runtime.state = runtime.failures >= 3 ? "error" : "degraded";

  // 断链兜底：保留最后一帧但标记为 bad，绝不静默显示假数据（企划 3.2）
  const last = frames[binding.asset_id];
  if (last) {
    frames = {
      ...frames,
      [binding.asset_id]: { ...last, quality: "bad" },
    };
  }
}

// ---------------------------------------------------------------- 适配器
let mockTick = 0;

/** 本地模拟器：无后端也能演示数据链路 */
function mockFrame(binding: TelemetryBinding): Partial<Record<MetricKey, number | string | boolean>> {
  mockTick += 1;
  const seed = binding.asset_id
    .split("")
    .reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const wave = Math.sin((mockTick + seed) / 6);
  const jitter = (Math.random() - 0.5) * 0.12;

  // 演示用：让每个绑定周期性轮转全部状态（正常/告警/严重/离线），
  // 既覆盖四类、也随模拟时钟变化，方便在 3D 标签上验证"状态汇总"的实时更新。
  // 不同绑定因 seed 偏移而处于不同阶段，同一时刻可见到混合状态。
  const phase = (mockTick + seed) % 16;
  let status: "online" | "warn" | "crit" | "offline";
  if (phase < 1) status = "offline";
  else if (phase < 4) status = "warn";
  else if (phase < 6) status = "crit";
  else status = "online";

  return {
    power_w: Math.round((1800 + seed % 900) * (1 + wave * 0.18 + jitter)),
    current_a: Number((8.2 + wave * 1.4 + jitter).toFixed(2)),
    voltage_v: Number((220 + wave * 2.5).toFixed(1)),
    temp_c: Number((24 + wave * 4 + jitter * 6).toFixed(1)),
    humidity: Number((45 + wave * 8).toFixed(1)),
    rpm: Math.round(3600 + wave * 900),
    status,
    on_off: status !== "offline",
  };
}

interface RestPayloadShape {
  id?: string;
  asset_id?: string;
  ts?: number;
  metrics?: Record<string, unknown>;
  quality?: FrameQuality;
  [key: string]: unknown;
}

/** REST 轮询：兼容三种响应形态（单对象 / 数组 / 带 assets 包装） */
async function pollRest(binding: TelemetryBinding): Promise<void> {
  const response = await fetch(binding.endpoint, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(Math.max(1500, (binding.poll_ms ?? DEFAULT_POLL_MS) - 500)),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const payload: unknown = await response.json();

  const candidates: RestPayloadShape[] = Array.isArray(payload)
    ? (payload as RestPayloadShape[])
    : Array.isArray((payload as { assets?: unknown })?.assets)
      ? ((payload as { assets: RestPayloadShape[] }).assets)
      : [payload as RestPayloadShape];

  const match =
    candidates.find(
      (item) =>
        item &&
        (item.asset_id === binding.asset_id || item.id === binding.asset_id),
    ) ?? (candidates.length === 1 ? candidates[0] : undefined);

  if (!match) {
    throw new Error(`响应中找不到资产 ${binding.asset_id}`);
  }

  const rawMetrics =
    match.metrics && typeof match.metrics === "object"
      ? (match.metrics as Record<string, unknown>)
      : (match as Record<string, unknown>);

  const metrics = normalizeMetrics(rawMetrics, binding.point_map);
  // 补充非数值字段，便于面板展示
  if (typeof match.status === "string" && metrics.status === undefined) {
    metrics.status = match.status;
  }
  if (typeof match.name === "string") {
    (metrics as Record<string, unknown>).name = match.name;
  }
  commitFrame(binding, metrics, payload, match.quality ?? "good");
}

type Runner = (binding: TelemetryBinding) => Promise<void> | void;

/** 适配器注册表：新增平台只需在此登记 */
const ADAPTER_RUNNERS: Record<AdapterType, Runner | null> = {
  mock: (binding) => {
    commitFrame(binding, mockFrame(binding), { adapter: "mock" });
  },
  rest: (binding) => pollRest(binding),
  mqtt: null,
  modbus: null,
  snmp: null,
  opcua: null,
};

// ---------------------------------------------------------------- 调度
function tick(binding: TelemetryBinding): void {
  const runner = ADAPTER_RUNNERS[binding.adapter];
  if (!runner) {
    const runtime = ensureRuntime(binding.id);
    runtime.state = "error";
    runtime.error = "该适配器尚未接入（后端适配器服务待开发）";
    return;
  }
  try {
    const result = runner(binding);
    if (result instanceof Promise) {
      result.catch((error: unknown) => reportFailure(binding, error));
    }
  } catch (error) {
    reportFailure(binding, error);
  }
}

function schedule(binding: TelemetryBinding): void {
  const existing = timers.get(binding.id);
  if (existing) clearInterval(existing);

  const interval = Math.max(500, binding.poll_ms ?? DEFAULT_POLL_MS);
  const runtime = ensureRuntime(binding.id);
  runtime.state = "connecting";

  tick(binding);
  timers.set(
    binding.id,
    setInterval(() => tick(binding), interval),
  );
}

/** 启动全部绑定的实时采集 */
export function startAll(): void {
  if (typeof window === "undefined") return;
  started = true;
  for (const binding of bindings) schedule(binding);
}

/** 停止全部采集 */
export function stopAll(): void {
  started = false;
  for (const timer of timers.values()) clearInterval(timer);
  timers.clear();
  runtimes = Object.fromEntries(
    Object.entries(runtimes).map(([id, runtime]) => [
      id,
      { ...runtime, state: "idle" as LinkState },
    ]),
  );
}

function restartIfRunning(): void {
  if (!started) return;
  stopAll();
  startAll();
}

// ---------------------------------------------------------------- 对外接口
export function getTelemetryStore() {
  return {
    get bindings() {
      return bindings;
    },
    get frames() {
      return frames;
    },
    get runtimes() {
      return runtimes;
    },
    get started() {
      return started;
    },
    /** 指标历史（asset_id → 指标 → 采样序列），供折线图使用 */
    get history() {
      return history;
    },

    addBinding(binding: TelemetryBinding) {
      bindings = [...bindings, binding];
      persist();
      if (started) schedule(binding);
    },

    updateBinding(id: string, patch: Partial<TelemetryBinding>) {
      bindings = bindings.map((b) => (b.id === id ? { ...b, ...patch } : b));
      persist();
      restartIfRunning();
    },

    removeBinding(id: string) {
      const timer = timers.get(id);
      if (timer) clearInterval(timer);
      timers.delete(id);
      bindings = bindings.filter((b) => b.id !== id);
      persist();
    },

    startAll,
    stopAll,

    /** 查询某资产的当前帧；超过陈旧窗口自动降级 quality */
    getFrame(assetId: string): TelemetryFrame | null {
      const frame = frames[assetId];
      if (!frame) return null;
      if (
        frame.quality === "good" &&
        Date.now() - frame.ts > STALE_AFTER_MS
      ) {
        return { ...frame, quality: "stale" };
      }
      return frame;
    },

    /** 某资产是否已绑定数据源 */
    hasBinding(assetId: string): boolean {
      return bindings.some((b) => b.asset_id === assetId);
    },

    /** 某资产某个指标的采样序列（可能为空数组） */
    getHistory(assetId: string, metric: MetricKey): number[] {
      return history[assetId]?.[metric] ?? [];
    },

    /** 整体链路健康度：最差的那个绑定决定总体状态 */
    get overallState(): LinkState {
      if (!started) return "idle";
      const states = Object.values(runtimes).map((r) => r.state);
      if (states.includes("error")) return "error";
      if (states.includes("degraded")) return "degraded";
      if (states.includes("live")) return "live";
      return "connecting";
    },
  };
}
