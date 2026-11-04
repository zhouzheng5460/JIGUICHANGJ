/**
 * i18n 弹窗 / 气泡覆盖回归
 * ============================================================================
 * 上游的确认弹窗与轻提示大量采用「英文模板 + 变量」结构，而变量（机柜名、
 * 布局名、设备名）在本项目里通常是中文。拼接出的混合串既不是纯英文、也不是
 * 纯中文，最容易被「含中文即跳过」的守卫漏掉（R27 回归）。
 *
 * 本测试直接对 `lookup()` 断言这些串必须译成中文，用于守住：
 *   1) ConfirmDialog 的标题 / 正文 / 按钮；
 *   2) 删除机柜、删除布局、清空机柜三类确认正文；
 *   3) 撤销 / 重做气泡（描述里嵌中文名）；
 *   4) 常见轻提示与浏览器存储提示条。
 */

import { describe, expect, it } from "vitest";

import { lookup } from "../lib/i18n/translator";

/** [英文原文, 期望译文] */
const CASES: Array<[string, string]> = [
  // ---------------------------------------------------------- 确认弹窗：删除布局
  [
    'Delete "机柜"? This removes it from your library and cannot be undone.',
    "删除 “机柜”？此操作会将其从布局库中移除，且无法撤销。",
  ],
  [
    'Are you sure you want to delete "机柜"? This cannot be undone.',
    "确定要删除 “机柜” 吗？此操作无法撤销。",
  ],
  // ---------------------------------------------------------- 确认弹窗：删除机柜
  [
    'Are you sure you want to delete "机柜"? 3 devices will be removed.',
    "确定要删除 “机柜” 吗？将移除 3 台设备。",
  ],
  [
    'Are you sure you want to delete "机柜"? 1 device will be removed.',
    "确定要删除 “机柜” 吗？将移除 1 台设备。",
  ],
  [
    'Are you sure you want to delete "机柜"?',
    "确定要删除 “机柜” 吗？",
  ],
  [
    'Delete "机柜 A"? All bays will be removed.',
    "删除 “机柜 A”？所有并柜都将被移除。",
  ],
  [
    'Delete "机柜 A"? This will remove 2 devices across all bays.',
    "删除 “机柜 A”？将移除全部并柜中的 2 台设备。",
  ],
  // ---------------------------------------------------------- 确认弹窗：清空机柜
  [
    "Remove all 3 devices from this rack? This action can be undone.",
    "移除该机柜的全部 3 台设备？此操作可以撤销。",
  ],
  [
    "Remove all 1 device from this rack? This action can be undone.",
    "移除该机柜的全部 1 台设备？此操作可以撤销。",
  ],
  // ---------------------------------------------------- 确认弹窗：删除设备类型
  [
    'Delete "机柜风扇"? This device is placed 2 times. All instances will be removed.',
    "删除 “机柜风扇”？该设备已被放置 2 次，所有实例都将被移除。",
  ],
  [
    'Delete "机柜风扇"? This will remove the device from your library.',
    "删除 “机柜风扇”？这将从设备库中移除该设备。",
  ],
  // ---------------------------------------------------------- 撤销 / 重做气泡
  ['Undid: Duplicate rack "机柜 A"', "已撤销：复制机柜 “机柜 A”"],
  ['Redid: Delete rack "机柜 A"', "已重做：删除机柜 “机柜 A”"],
  // ---------------------------------------------------------------- 轻提示
  [
    "Layouts are saved only in this browser. Save a file to keep a copy.",
    "布局只保存在本浏览器中。保存为文件可另存一份。",
  ],
  ['Deleted "机柜"', "已删除 “机柜”"],
  ['Closed "机柜"', "已关闭 “机柜”"],
  ['Could not delete "机柜"', "无法删除 “机柜”"],
  ['Duplicated as "机柜 A（副本）"', "已复制为 “机柜 A（副本）”"],
  ['"机柜" is corrupted and cannot be opened', "“机柜” 已损坏，无法打开"],
  ['"UPS 电源" added to Devices', "已将 “UPS 电源” 添加到设备库"],
  ["Can't bay this rack", "无法并柜"],
  ["Export failed", "导出失败"],
  ["Device duplicated", "设备已复制"],
  ["Rack duplicated", "机柜已复制"],
  ["YAML applied", "YAML 已应用"],
  ["Import failed: bad schema", "导入失败：bad schema"],
  ["Active: 机柜 A", "当前机柜：机柜 A"],
  // ---------------------------------------------------------- 面别切换提示
  ["Flipped to front", "已翻转到正面"],
  ["Flipped to rear", "已翻转到背面"],
  [
    "Cannot flip to front: the face is blocked",
    "无法翻转到正面：该面已被占用",
  ],
  [
    "Cannot change to full-depth: blocked by UPS 电源",
    "无法切换为全深：与 UPS 电源 冲突",
  ],
  [
    "Cannot change to rear: blocked by 配线架",
    "无法切换为背面：与 配线架 冲突",
  ],
  // ---------------------------------------------------------- 移动受阻 / 导入结果
  ["Already at the top of the rack", "已到机柜顶部"],
  ["Already at the bottom of the rack", "已到机柜底部"],
  ["No free slot to move up", "没有空位可以上移"],
  ["No free slot to move down", "没有空位可以下移"],
  ["Imported 3 devices (1 skipped)", "已导入 3 台设备（跳过 1 台）"],
  ["Imported 1 device", "已导入 1 台设备"],
  ["Imported 12 devices", "已导入 12 台设备"],
];

describe("i18n · 弹窗与气泡", () => {
  it.each(CASES)("翻译 %j", (source, expected) => {
    expect(lookup(source)).toBe(expected);
  });

  it("已译出的中文串不会被二次翻译（幂等）", () => {
    for (const [, chinese] of CASES) {
      expect(lookup(chinese)).toBeNull();
    }
  });

  it("纯中文界面文案不参与翻译", () => {
    expect(lookup("删除 “机柜”？")).toBeNull();
    expect(lookup("机柜 A")).toBeNull();
  });
});
