/**
 * Rack3D 遥测数据模型
 * ============================================================================
 * 对齐企划 M3：所有采集平台（MQTT / Modbus / SNMP / REST / OPC-UA）最终都被
 * 适配器归一化为统一的 TelemetryFrame，业务层只面向标准帧，不感知平台差异。
 */

/** 采集适配器类型 */
export type AdapterType = "rest" | "mqtt" | "modbus" | "snmp" | "opcua" | "mock";

/** 标准指标名（归一化后的业务指标，非平台原始点位） */
export type MetricKey =
  | "power_w"
  | "current_a"
  | "voltage_v"
  | "temp_c"
  | "humidity"
  | "status"
  | "rpm"
  | "on_off";

/** 指标中文标签 */
export const METRIC_LABELS: Record<MetricKey, string> = {
  power_w: "功率 (W)",
  current_a: "电流 (A)",
  voltage_v: "电压 (V)",
  temp_c: "温度 (°C)",
  humidity: "湿度 (%)",
  status: "状态",
  rpm: "转速 (RPM)",
  on_off: "开关",
};

/** 指标单位 */
export const METRIC_UNITS: Record<MetricKey, string> = {
  power_w: "W",
  current_a: "A",
  voltage_v: "V",
  temp_c: "°C",
  humidity: "%",
  status: "",
  rpm: "RPM",
  on_off: "",
};

/** 全部可选指标（用于绑定表单） */
export const ALL_METRICS: readonly MetricKey[] = [
  "power_w",
  "current_a",
  "voltage_v",
  "temp_c",
  "humidity",
  "status",
  "on_off",
  "rpm",
];

/** 数值型指标（可参与阈值告警与曲线） */
export const NUMERIC_METRICS: readonly MetricKey[] = [
  "power_w",
  "current_a",
  "voltage_v",
  "temp_c",
  "humidity",
  "rpm",
];

/** 绑定层级：机柜级 / 设备级 */
export type AssetKind = "rack" | "device";

/** 数据质量：断链兜底依据（企划 3.2） */
export type FrameQuality = "good" | "stale" | "bad";

/** 阈值规则 */
export interface MetricThreshold {
  warn: number;
  crit: number;
}

/**
 * 数据源配置：一条绑定 = 一个资产 + 一个采集来源 + 一份点位映射
 */
export interface TelemetryBinding {
  /** 稳定主键 */
  id: string;
  /** 绑定层级 */
  asset_kind: AssetKind;
  /** 机柜 id 或设备 id（placedDevice.id） */
  asset_id: string;
  /** 展示名（便于识别） */
  label: string;
  /** 采集适配器 */
  adapter: AdapterType;
  /** 采集端点：REST 为 URL；MQTT 为 broker 地址；Modbus 为 tcp://host:port 等 */
  endpoint: string;
  /** 该资产要展示的指标 */
  metrics: MetricKey[];
  /**
   * 点位映射：采集平台原始点位名 → 标准指标。
   * 例：{ "P_total": "power_w", "T_in": "temp_c" }
   */
  point_map: Record<string, MetricKey>;
  /** 阈值告警（可选） */
  thresholds?: Partial<Record<MetricKey, MetricThreshold>>;
  /** REST 轮询间隔（毫秒），仅 adapter=rest 时生效 */
  poll_ms?: number;
}

/** 标准遥测帧 */
export interface TelemetryFrame {
  asset_id: string;
  /** Unix 毫秒时间戳 */
  ts: number;
  /** 归一化后的指标值 */
  metrics: Partial<Record<MetricKey, number | string | boolean>>;
  quality: FrameQuality;
  /** 原始帧，便于排查链路问题 */
  raw?: unknown;
}

/** 链路健康状态 */
export type LinkState = "idle" | "connecting" | "live" | "degraded" | "error";

/** 单个绑定的运行时状态 */
export interface BindingRuntime {
  state: LinkState;
  lastFrameTs: number | null;
  /** 最近一次错误信息 */
  error?: string;
  /** 连续失败次数 */
  failures: number;
}

/** 数据源类型的中文标签 */
export const ADAPTER_LABELS: Record<AdapterType, string> = {
  rest: "REST / HTTP 轮询",
  mqtt: "MQTT 订阅",
  modbus: "Modbus TCP",
  snmp: "SNMP",
  opcua: "OPC-UA",
  mock: "本地模拟器（演示）",
};

/** 数据质量的中文标签 */
export const QUALITY_LABELS: Record<FrameQuality, string> = {
  good: "正常",
  stale: "数据陈旧",
  bad: "链路异常",
};

/** 链路状态的中文标签 */
export const LINK_STATE_LABELS: Record<LinkState, string> = {
  idle: "未启动",
  connecting: "连接中",
  live: "实时",
  degraded: "降级",
  error: "异常",
};

/** 数据陈旧判定窗口（毫秒） */
export const STALE_AFTER_MS = 8000;

/** 默认轮询间隔（毫秒） */
export const DEFAULT_POLL_MS = 3000;
