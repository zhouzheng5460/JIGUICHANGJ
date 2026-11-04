/**
 * 新建对象 / 复制对象的默认名称
 * ============================================================================
 * 名称是**持久化数据**（写进 localStorage 与导出 YAML），不是纯展示层文案，
 * 因此不能靠运行期 DOM 词典层翻译 —— 必须在创建时就按当前语言生成。
 *
 * 上游原本硬编码英文默认名（Racky McRackface / My Layout / "… (Copy)"），
 * 这里按 locale 收口成三个函数，调用方只认这几个函数，不再写死字符串。
 */

import { isChinese } from "./locale";

/** 新建机柜的默认名（重名时上游会追加 " 2"、" 3"…） */
export function defaultRackName(): string {
  return isChinese() ? "机柜" : "Racky McRackface";
}

/** 新建布局的默认名 */
export function defaultLayoutName(): string {
  return isChinese() ? "我的布局" : "My Layout";
}

/** 并柜新增一柜的默认名（bayNumber 从 2 起） */
export function bayRackName(bayNumber: number): string {
  return isChinese() ? `并柜 ${bayNumber}` : `Bay ${bayNumber}`;
}

/** 复制对象的名字后缀：英文 "(Copy)" → 中文「（副本）」 */
export function withCopySuffix(name: string): string {
  return isChinese() ? `${name}（副本）` : `${name} (Copy)`;
}

/**
 * 布局库复制命名后缀（第 n 份副本，n 从 1 起）。
 * 上游是 `<base> Copy` / `<base> Copy 2`（无括号，与机柜/设备的 `(Copy)` 不同款），
 * 中文对应「<base> 副本」/「<base> 副本 2」。
 */
export function copySuffix(n: number): string {
  if (isChinese()) return n <= 1 ? " 副本" : ` 副本 ${n}`;
  return n <= 1 ? " Copy" : ` Copy ${n}`;
}
