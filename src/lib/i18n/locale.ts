/**
 * Rack3D 语言状态（zh-CN 为默认）
 * ============================================================================
 * 切换语言会持久化到 localStorage 后整页重载：译文替换是不可逆的 DOM 改写，
 * 重载是最可靠、最省心的还原路径（也避免维护反向词典）。
 */

import { safeGetItem, safeSetItem } from "$lib/utils/safe-storage";
import { startTranslator, stopTranslator } from "./translator";

export type Locale = "zh-CN" | "en";

const LOCALE_KEY = "rack3d_locale";

export const LOCALE_OPTIONS: readonly { value: Locale; label: string }[] = [
  { value: "zh-CN", label: "中文" },
  { value: "en", label: "English" },
];

function readStoredLocale(): Locale {
  const stored = safeGetItem(LOCALE_KEY);
  // 默认中文：未显式选择过英文时一律走汉化
  return stored === "en" ? "en" : "zh-CN";
}

let current: Locale = readStoredLocale();

export function getLocale(): Locale {
  return current;
}

export function isChinese(): boolean {
  return current === "zh-CN";
}

/** 切换语言（会整页重载） */
export function setLocale(next: Locale): void {
  if (next === current) return;
  safeSetItem(LOCALE_KEY, next);
  current = next;
  if (typeof location !== "undefined") {
    location.reload();
  }
}

/** 在应用挂载时初始化：设置 html lang 并启动词典层 */
export function initI18n(): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = current === "zh-CN" ? "zh-CN" : "en";

  if (current !== "zh-CN") {
    stopTranslator();
    return;
  }

  // 同步执行：mount() 之后到浏览器首次绘制之前完成翻译，避免英文闪现
  if (document.body) {
    startTranslator();
  } else {
    document.addEventListener("DOMContentLoaded", () => startTranslator(), {
      once: true,
    });
  }
}
