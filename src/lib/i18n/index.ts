/**
 * Rack3D i18n 入口
 *
 * 用法：
 *   import { initI18n, getLocale, setLocale } from "$lib/i18n";
 */
export {
  getLocale,
  isChinese,
  setLocale,
  initI18n,
  LOCALE_OPTIONS,
  type Locale,
} from "./locale";
export { lookup, startTranslator, stopTranslator } from "./translator";
