/**
 * Rack3D 汉化词典（zh-CN）
 * ============================================================================
 * 设计说明（Rack3D 扩展层，非 Rackula 上游代码）
 *
 * 为什么用"运行期词典"而不是逐组件改造：
 *   1. Rackula 有 150+ 个 Svelte 组件、800+ 条英文文案。逐条替换会把
 *      自有改动散布到几乎每个上游文件里，后续 `upstream/main` rebase 会变成
 *      灾难（企划 6.4 明确要求"上游代码原则上不动"）。
 *   2. 本文件 + translator.ts 构成一个可整体替换的"词典层"：上游代码零改动，
 *      上游大重构也不会与汉化冲突。
 *   3. 词典即唯一维护面：要改文案只改这里，不动业务代码。
 *
 * 匹配规则：
 *   - TEXT：按"归一化后的英文原文"精确匹配（连续空白折叠为一个空格、首尾裁剪）。
 *     用于文本节点，以及 placeholder / title / aria-label / alt / value 属性。
 *   - RULES：正则规则，用于带变量的动态文案（如 "1 device" / "3 devices"）。
 *     `$1` 等捕获组可用。
 *   - 匹配不到时保留英文原文（渐进式降级，绝不显示空白）。
 *
 * 新增文案：把英文原文原样作为 key 加进 TEXT 即可。
 */

/** 精确匹配词典：英文原文 → 简体中文 */
export const TEXT: Record<string, string> = {
  // ---------------------------------------------------------------- 通用动作
  Add: "添加",
  Cancel: "取消",
  Clear: "清空",
  Close: "关闭",
  Commit: "提交",
  Confirm: "确认",
  Copy: "复制",
  Create: "创建",
  Delete: "删除",
  Done: "完成",
  Download: "下载",
  Edit: "编辑",
  Export: "导出",
  "Export...": "导出…",
  "Exporting...": "导出中…",
  Flip: "翻转",
  "Flip face": "翻转面",
  Focus: "聚焦",
  Hide: "隐藏",
  Import: "导入",
  Keep: "保留",
  "Keep All": "全部保留",
  "Load Layout": "加载布局",
  Move: "移动",
  "Move Down": "下移",
  "Move Up": "上移",
  "Move down 1U": "下移 1U",
  "Move up 1U": "上移 1U",
  "Move device down by 1 rack unit": "将设备下移 1 个机架单元",
  "Move device up by 1 rack unit": "将设备上移 1 个机架单元",
  "Move rack left": "机柜左移",
  "Move rack right": "机柜右移",
  Next: "下一步",
  OK: "确定",
  Open: "打开",
  "Open in another tab": "在新标签页中打开",
  "Open layout": "打开布局",
  "Open layouts": "打开布局",
  Remove: "移除",
  "Remove bay": "移除并柜",
  "Remove from rack": "从机柜移除",
  "Remove from Rack": "从机柜移除",
  "Remove image": "移除图片",
  Rename: "重命名",
  Replace: "替换",
  "Replace server copy": "替换服务器副本",
  Reset: "重置",
  "Reset to default": "恢复默认",
  "Reset to default colour": "恢复默认颜色",
  "Reset dismissed prompts": "重置已忽略的提示",
  "Reset zoom": "重置缩放",
  "Reset Zoom": "重置缩放",
  Restore: "恢复",
  "Restoring...": "恢复中…",
  Retry: "重试",
  Save: "保存",
  "Save As": "另存为",
  "Save First": "先保存",
  "Save all layouts": "保存全部布局",
  "Save to file": "保存到文件",
  "Save to server": "保存到服务器",
  Saved: "已保存",
  Search: "搜索",
  "Select All": "全选",
  "Set override": "设置覆盖值",
  Share: "分享",
  "Share Layout": "分享布局",
  "Share Link": "分享链接",
  Show: "显示",
  Skip: "跳过",
  "Skip to canvas": "跳到画布",
  "Stay in browser mode": "继续使用浏览器模式",
  "Switch back to browser mode": "切回浏览器模式",
  "Switch to server mode": "切换到服务器模式",
  Undo: "撤销",
  Redo: "重做",
  "Undo All": "全部撤销",
  "Unpin device": "取消固定设备",
  "Unpin from top": "取消置顶",
  Upload: "上传",
  "Upload File": "上传文件",
  "Upload and switch": "上传并切换",
  "Upload and switch?": "上传并切换？",
  "Uploading...": "上传中…",
  "Working...": "处理中…",
  "Applying...": "应用中…",
  "Parsing...": "解析中…",
  "Choose File": "选择文件",

  // ---------------------------------------------------------------- 面板 / 导航
  View: "视图",
  Data: "数据",
  Layouts: "布局",
  Racks: "机柜",
  Devices: "设备",
  Settings: "设置",
  Theme: "主题",
  "Colour theme": "配色方案",
  Logo: "LOGO",
  "Dracula Purple": "经典紫",
  "Ocean Blue": "深海蓝",
  "Forest Green": "森林绿",
  "Sunset Orange": "落日橙",
  "Morning Mist": "晨雾浅色",
  "Custom logo in use.": "已使用自定义 LOGO。",
  "Using the default logo. Upload an SVG to replace it.":
    "当前使用默认 LOGO，上传 SVG 即可替换。",
  "Upload SVG": "上传 SVG",
  "Restore default logo": "恢复默认 LOGO",
  Appearance: "外观",
  Behaviour: "行为",
  Selection: "选择",
  Placement: "放置",
  Position: "位置",
  Identity: "标识",
  Group: "分组",
  Grouping: "分组",
  "Grouping mode": "分组方式",
  Category: "类别",
  Tags: "标签",
  Notes: "备注",
  "Notes (optional)": "备注（可选）",
  Format: "格式",
  Label: "标签",
  Type: "类型",
  Brand: "品牌",
  Manufacturer: "厂商",
  "Part Number": "零件号",
  "Serial Number": "序列号",
  "Asset Tag": "资产编号",
  "IP Address": "IP 地址",
  "IP Address/Hostname": "IP 地址/主机名",
  Management: "管理",
  "Management Only": "仅管理",
  "Rack list": "机柜列表",
  "Rack navigation": "机柜导航",
  "Rack actions": "机柜操作",
  "Device actions": "设备操作",
  "Device type details": "设备型号详情",
  "Device type notes": "设备型号备注",
  "History actions": "历史操作",
  "View actions": "视图操作",
  "Zoom controls": "缩放控件",
  "Mobile navigation": "移动端导航",
  "Panel sections": "面板分区",
  "Sidebar navigation": "侧边栏导航",
  "Command palette": "命令面板",
  Commands: "命令",
  "Back to commands": "返回命令列表",
  "Layout library": "布局库",
  "Layout name": "布局名称",
  "Layout YAML": "布局 YAML",
  "Layout YAML editor": "布局 YAML 编辑器",
  "Edit YAML": "编辑 YAML",
  "Apply YAML": "应用 YAML",
  "Copy YAML": "复制 YAML",
  "Download YAML": "下载 YAML",
  Documentation: "文档",
  "About Rackula": "关于 Rackula",
  Version: "版本",
  "Report Bug": "反馈问题",
  "Share Ideas": "分享想法",

  // ------------------------------------------------- 命令面板：分组标题 / 页脚
  // 分组标题在 DOM 里是小写原样文本（大写是 CSS text-transform），故按原串入表。
  "Create / Add device": "新建 / 添加设备",
  "Navigation / View": "导航 / 视图",
  "File / Document": "文件 / 文档",
  Workspace: "工作区",
  App: "应用",
  // 页脚提示：各 <span> 里是「<kbd> + 文本节点」结构，命中的是独立文本节点
  navigate: "导航",
  run: "执行",
  close: "关闭",

  // ------------------------------------------------- 命令面板：命令标签
  "New custom device": "新建自定义设备",
  "Fit all (zoom to fit)": "适应全部（缩放至合适）",
  "Toggle annotations": "开关标注",
  "About and shortcuts": "关于与快捷键",
  "Duplicate selection": "复制所选",
  "Save layout (.yaml)": "保存布局（.yaml）",
  "Save all layouts (.zip)": "保存全部布局（.zip）",
  "Export image": "导出图片",
  "View YAML": "查看 YAML",
  "Import devices": "导入设备",
  "Remove selected": "移除所选",
  "Move device up": "上移设备",
  "Move device down": "下移设备",
  "Move to next cell": "移到下一格",
  "Clear selection / close dialog": "清除选择 / 关闭弹窗",
  "Save As (ZIP)": "另存为（ZIP）",
  // 内置布局模板名（命令面板「从模板新建布局：…」的二次查词命中点）
  "Home Lab": "家庭实验室",
  "Network Closet": "网络机柜间",
  "Media Server": "媒体服务器",

  // ---------------------------------------------------------------- 机柜属性
  Rack: "机柜",
  "New Rack": "新建机柜",
  "New rack": "新建机柜",
  "Edit Rack": "编辑机柜",
  "Delete Rack": "删除机柜",
  "Delete rack": "删除机柜",
  "Delete Rack?": "删除机柜？",
  "Duplicate Rack": "复制机柜",
  Duplicate: "复制",
  "Bayed Rack": "并柜机柜",
  "Delete Bayed Rack": "删除并柜机柜",
  "Delete bayed rack": "删除并柜机柜",
  "Clear Rack": "清空机柜",
  "Clear all devices from rack": "清空机柜中的全部设备",
  "No rack selected": "未选择机柜",
  "No racks configured": "未配置机柜",
  "No racks yet": "还没有机柜",
  "No racks yet. Add one to get started.": "还没有机柜，先添加一个开始吧。",
  "Add a rack": "添加机柜",
  "Add bay": "添加并柜",
  "Bay rack": "并柜",
  "Bay Count": "并柜数量",
  "Bay count controls": "并柜数量控件",
  "Pull to bay": "拖拽以并柜",
  "Release to bay": "松开以并柜",
  "Drag right to bay a new rack": "向右拖拽以并入新机柜",
  "Drag right to create a bayed rack": "向右拖拽以创建并柜",
  "Previous rack": "上一个机柜",
  "Next rack": "下一个机柜",
  "Rack Width": "机柜宽度",
  "Rack width in inches": "机柜宽度（英寸）",
  "Rack Width Compatibility": "机柜宽度兼容性",
  "Which rack sizes this device fits": "该设备适配的机柜尺寸",
  "Height (U)": "高度（U）",
  "Add device": "添加设备",
  "Add Device": "添加设备",
  "Add device...": "添加设备…",
  "Add a device to get started": "添加一台设备开始吧",
  "Add a rack to control its rear view.": "请先添加机柜以控制其后视图。",
  "Add custom device": "添加自定义设备",
  "Create custom device": "创建自定义设备",
  "Create a layout to get started": "创建一个布局开始吧",
  "Create your first rack to get started": "创建你的第一个机柜开始吧",
  "This layout has no racks yet.": "该布局还没有机柜。",
  "Search devices": "搜索设备",
  "Search devices...": "搜索设备…",
  "Filter devices": "筛选设备",
  "Clear filters": "清除筛选",
  "Compatible devices only": "仅显示兼容设备",
  "Hide devices that do not fit the active rack width.":
    "隐藏不适配当前机柜宽度的设备。",
  "Invalid file": "文件无效",
  "No devices in library": "设备库中没有设备",
  "No devices match": "没有匹配的设备",
  "No matching devices": "没有匹配的设备",
  "No matching commands": "没有匹配的命令",
  "All Devices": "全部设备",

  // ---------------------------------------------------------------- 设备库 / 导入
  "Import devices file": "导入设备文件",
  "Import from local file": "从本地文件导入",
  "Import from local file (.zip)": "从本地文件导入（.zip）",
  "Import from NetBox": "从 NetBox 导入",
  "Import input mode": "导入输入方式",
  "From template": "从模板创建",
  "New from template": "从模板新建",
  "Starter templates": "起始模板",
  "Blank layout": "空白布局",
  "New layout": "新建布局",
  "New layout (new tab)": "新建布局（新标签页）",
  "New layout options": "新建布局选项",
  "Delete Layout": "删除布局",
  "Delete Layout?": "删除布局？",
  "Delete layout": "删除布局",
  "Rename Layout": "重命名布局",
  Untitled: "未命名",
  "Untitled Rack": "未命名机柜",

  // ---------------------------------------------------------------- 设备属性
  Device: "设备",
  Height: "高度",
  Width: "宽度",
  Depth: "深度",
  "Depth (mm)": "深度（mm）",
  "Form Factor": "机柜形式",
  "U Numbering": "U 位编号",
  "U numbering direction": "U 位编号方向",
  "U1 at bottom": "U1 在底部",
  "U1 at top": "U1 在顶部",
  "Base Weight": "机柜自重",
  "Show Rear View": "显示后视图",
  "Show rear view on canvas": "在画布上显示后视图",
  "Annotation Field": "标注字段",
  "Field shown in annotation column (press N to toggle)":
    "标注列显示的字段（按 N 键切换）",
  Annotations: "标注",
  Colour: "颜色",
  Color: "颜色",
  "Custom hex colour": "自定义十六进制颜色",
  "Full Depth": "全深度",
  "Half Width": "半宽",
  Full: "全宽",
  Half: "半宽",
  "Both Faces": "双面",
  "Both (full-depth)": "双面（全深度）",
  "Half-depth device": "半深度设备",
  "Half-depth: Mounts on one face only": "半深度：仅安装在单面",
  "Half-width device": "半宽设备",
  "Half-width: Mounts inside a carrier, not directly on the rails":
    "半宽：安装在托架内，不直接上导轨",
  "Occupies both front and rear rack faces": "同时占用机柜前后两面",
  "Occupies left or right half of rack width": "占用机柜宽度的一半（左或右）",
  "Set by device depth. To mount on a single face, change the device type to half-depth.":
    "由设备深度决定。若需单面安装，请把设备型号改为半深度。",
  "Mounted Face": "安装面",
  Container: "容器",
  "Container U": "容器 U 位",
  "Inside Container": "容器内部",
  Slot: "插槽",
  "Airflow:": "气流方向：",
  Outlets: "插座",
  "VA Rating": "VA 额定值",
  "PoE Powered": "PoE 受电",
  "PoE Source": "PoE 供电",
  // 端口悬浮气泡里的信号类型名（SIGNAL_LABELS）
  "Mic level": "麦克风电平",
  "Line level": "线路电平",
  "Speaker level": "扬声器电平",
  "Word clock": "字时钟",
  Universal: "通用",
  Generic: "通用",
  "Add notes about this rack...": "为该机柜添加备注…",
  "Add notes about this placement": "为该放置位置添加备注",
  "Add notes about this device placement...": "为该设备的放置位置添加备注…",
  "Additional notes about the device...": "关于该设备的补充说明…",
  "Delete Device Type": "删除设备型号",
  "Delete unused device type": "删除未使用的设备型号",
  "Unused device types": "未使用的设备型号",
  "Clean Up Device Library": "清理设备库",
  "Clean Up Device Library?": "清理设备库？",
  "Clean up unused device types": "清理未使用的设备型号",
  "Prompt to clean up unused types": "保存前提示清理未使用的型号",
  "Offer to remove unused custom device types before saving or exporting.":
    "在保存或导出前，提示移除未使用的自定义设备型号。",
  "No unused custom device types right now.": "当前没有未使用的自定义设备型号。",
  "No unused device types found.": "未找到未使用的设备型号。",
  "Delete from Library": "从设备库删除",
  "Delete from library": "从设备库删除",
  "Has image": "有图片",
  "No image": "无图片",
  "No device type image": "设备型号无图片",
  "Using device type image": "使用设备型号图片",
  "Front Image": "正面图片",
  "Rear Image": "背面图片",
  "Front image available": "有正面图片",
  "Rear image available": "有背面图片",
  "Front and rear images available": "正面与背面图片均可用",
  "Override set": "已设置覆盖值",
  "Previous layout kept in Layouts": "原布局已保留在布局库中",

  // ---------------------------------------------------------------- 显示模式
  "Display mode": "显示模式",
  "Display Mode": "显示模式",
  "Toggle display mode": "切换显示模式",
  Labels: "标签",
  Images: "图片",
  Both: "两者",
  Image: "图片",
  "Image + Label": "图片 + 标签",
  "Fit all": "适应全部",
  "Fit All": "适应全部",
  "Zoom in": "放大",
  "Zoom out": "缩小",
  Zoom: "缩放",
  "U position labels": "U 位标签",
  FRONT: "正面",
  REAR: "背面",
  Front: "正面",
  Rear: "背面",
  "Front Only": "仅正面",
  "Rear Only": "仅背面",
  "Rear View": "后视图",
  "Front & Rear (Side-by-Side)": "正面与背面（并排）",
  "Banana for scale": "香蕉比例尺",
  "Banana for scale (7 inches)": "香蕉比例尺（7 英寸）",
  "Banana for scale (approximately 7 inches)": "香蕉比例尺（约 7 英寸）",
  "Show a banana beside racks for a sense of size.":
    "在机柜旁显示一根香蕉，便于感知尺寸。",
  "Show the annotation column beside each rack.": "在每个机柜旁显示标注列。",
  "Show the controls for baying racks together. Existing bays stay put when off.":
    "显示并柜操作控件。关闭时已有并柜不受影响。",
  "Lock the layout for viewing": "锁定布局为只读查看",
  "Read-only": "只读",
  "Read-only mode": "只读模式",
  "Editable mode": "可编辑模式",
  "Warn on unsaved changes": "未保存变更提醒",
  "Confirm before leaving with unsaved work.": "存在未保存内容时，离开前先确认。",
  "Enable bayed racks": "启用并柜",
  "Transparent background": "透明背景",
  "Include legend": "包含图例",
  "Include sharing QR code": "包含分享二维码",
  "QR Code": "二维码",
  "QR code for layout": "布局二维码",
  "Download QR": "下载二维码",
  "Scan to open in": "扫码打开",
  "Layout too large for QR code": "布局过大，无法生成二维码",
  "Generating QR code...": "正在生成二维码…",
  "Failed to generate QR code": "二维码生成失败",
  "CSV (Spreadsheet)": "CSV（表格）",
  "Download Layout File": "下载布局文件",
  "Exports rack contents as a spreadsheet with device positions, names, models, and categories.":
    "将机柜内容导出为表格，包含设备位置、名称、型号与类别。",

  // ---------------------------------------------------------------- 存储 / 服务器
  Storage: "存储",
  "Last saved": "上次保存",
  "Last exported": "上次导出",
  "Last reached server": "上次连接服务器",
  "Never saved": "从未保存",
  "Not yet saved": "尚未保存",
  "Not exported": "未导出",
  "Layouts, racks and devices panel": "布局、机柜与设备面板",
  "Not saved to the server": "未保存到服务器",
  "Saved on Server": "已保存到服务器",
  "Stored on the server": "存储在服务器",
  "Stored in this browser only": "仅存储在此浏览器",
  "Auto-saved": "自动保存",
  "No saved layouts": "没有已保存的布局",
  "No layouts saved on server yet.": "服务器上还没有保存的布局。",
  "Loading saved layouts...": "正在加载已保存的布局…",
  "Loading snapshots...": "正在加载快照…",
  "Show snapshots": "显示快照",
  "No snapshots for this layout.": "该布局没有快照。",
  "Failed to load snapshots": "快照加载失败",
  "Failed to load layouts": "布局加载失败",
  "Failed to delete layout": "布局删除失败",
  "Failed to download layout": "布局下载失败",
  "This layout has not been saved to the server.": "该布局尚未保存到服务器。",
  "Unable to reach the server. Please check your connection.":
    "无法连接服务器，请检查网络。",
  "A storage server is available": "检测到可用的存储服务器",
  "a server is reachable": "可连接服务器",
  "A copy already exists on the server": "服务器上已存在副本",
  "Keep server copy": "保留服务器副本",
  "Reload latest": "重新加载最新版本",
  "Reload": "重新加载",
  "Layout changed while this editor was open.": "编辑器打开期间布局已被修改。",
  "Choose how to proceed to avoid overwriting newer layout changes by mistake.":
    "请选择处理方式，避免误覆盖较新的布局改动。",
  "Your most recent edits may not be saved.": "你最近的修改可能未保存。",
  "Your open layout is safe. Retry to list the rest.":
    "当前打开的布局是安全的，重试以列出其余内容。",
  "Restore from backup (.zip)": "从备份恢复（.zip）",
  "This deployment now stores layouts on the server. Upload your local copy to keep it here.":
    "该部署现在把布局存储在服务器上。上传你的本地副本以保留在此。",
  "No prompts are dismissed.": "没有已忽略的提示。",
  "The clean-up prompt is currently dismissed.": "清理提示当前已被忽略。",
  "Don't ask again": "不再询问",
  "Apply anyway": "仍然应用",
  "Cancel edits": "放弃修改",
  "Invalid share link": "分享链接无效",
  "Shared layout loaded": "已加载分享的布局",
  "Link copied to clipboard": "链接已复制到剪贴板",
  "Copy link to clipboard": "复制链接到剪贴板",
  "Failed to copy link": "复制链接失败",
  "Failed to copy": "复制失败",

  // ------------------------------------------------------------ 轻提示（toast）
  // 轻提示是运行期动态插入的节点，靠 translator 的 addedNodes 分支翻译。
  "Device duplicated": "设备已复制",
  "Rack duplicated": "机柜已复制",
  "No rack to export": "没有可导出的机柜",
  "No rack to share": "没有可分享的机柜",
  "No room for this device here": "此处放不下该设备",
  "Maximum number of racks reached": "已达机柜数量上限",
  "Can't bay this rack": "无法并柜",
  "Export failed": "导出失败",
  "SVG exported successfully": "SVG 导出成功",
  "PNG exported successfully": "PNG 导出成功",
  "JPEG exported successfully": "JPEG 导出成功",
  "PDF exported successfully": "PDF 导出成功",
  "Layout saved": "布局已保存",
  "Save failed": "保存失败",
  "Failed to save layout. Please try again.": "布局保存失败，请重试。",
  "Backed up all layouts": "已备份全部布局",
  "No layouts to export": "没有可导出的布局",
  "YAML copied to clipboard": "YAML 已复制到剪贴板",
  "Failed to copy YAML": "复制 YAML 失败",
  "Failed to apply YAML layout": "应用 YAML 布局失败",
  "Party Mode!": "派对模式！",
  // 浏览器模式下的存储提示（backup-nudge 的 STORAGE_NOTICE_MESSAGE，带「保存」动作）
  "Layouts are saved only in this browser. Save a file to keep a copy.":
    "布局只保存在本浏览器中。保存为文件可另存一份。",
  // 多标签页互斥：同一布局在另一标签页打开时暂停本页编辑
  "This layout is open in another tab. Edits here are paused to avoid overwriting it. Reload to continue editing.":
    "该布局已在另一个标签页中打开。为避免相互覆盖，此处的编辑已暂停；重新加载后可继续。",

  // ------------------------------------------------ 导入 / YAML / 布局校验
  "Failed to import devices": "导入设备失败",
  "Layout format is invalid or outdated": "布局格式无效或版本过旧",
  "YAML applied": "YAML 已应用",

  // ------------------------------------------------ 服务器模式（本地浏览器模式不会出现）
  "Save failed — backend unavailable": "保存失败 — 后端不可用",
  "Server unavailable. Working offline; changes saved locally. Reload to retry.":
    "服务器不可用。已转入离线模式，改动保存在本地；重新加载可重试。",
  "Your session expired. Reload to re-authenticate; your changes are saved locally.":
    "登录状态已过期。重新加载可重新认证，你的改动已保存在本地。",
  "The storage server is no longer reachable.": "已无法连接存储服务器。",
  "Could not save the server-mode preference in this browser. Check private browsing or storage settings.":
    "无法在本浏览器中保存「服务器模式」偏好。请检查隐私模式或存储设置。",
  "Couldn't save your latest edits; the copy reflects the last saved server state.":
    "未能保存最新改动；该副本反映的是服务器上次保存的状态。",
  "Build info copied": "构建信息已复制",
  "Layout file downloaded": "布局文件已下载",
  "Unable to encode layout": "布局编码失败",
  "File corrupted": "文件已损坏",
  "Corrupted file": "文件已损坏",
  "Failed to read file": "文件读取失败",
  "Failed to process image": "图片处理失败",
  "Preview generation failed": "预览生成失败",
  "Export preview generation failed:": "导出预览生成失败：",
  "An unexpected error occurred. Please try again.": "发生意外错误，请重试。",
  "Unknown error": "未知错误",
  Unknown: "未知",
  "Name is required": "名称为必填项",
  // 设备属性面板的「名称」标签（标识信息 / 新建布局菜单 / 侧栏页签此前已译好）
  Name: "名称",
  // 布局库卡片状态
  Active: "使用中",
  Closed: "未打开",
  "Base weight must be zero or a positive number.": "机柜自重必须为 0 或正数。",
  "Depth must be a positive number in millimetres.":
    "深度必须为正数（单位：毫米）。",
  "Bayed racks must share the same height.": "并柜中的所有机柜必须高度一致。",
  "All instances will be removed": "所有实例都将被移除",
  "All devices in this rack will be removed": "该机柜中的所有设备都将被移除",
  "This will remove the device from your library.": "这将从设备库中移除该设备。",
  "Replace this layout?": "替换当前布局？",
  "Replace Current Rack?": "替换当前机柜？",

  // ---------------------------------------------------------------- 交互提示
  "Select a rack or device to edit its properties.":
    "选择一个机柜或设备以编辑其属性。",
  "Add a device called '<query>'": "添加名为 “<query>” 的设备",
  "Can't place device here": "无法放置到此处",
  "Cancel placement": "取消放置",
  Placing: "放置中",
  "Tap a slot to place.": "点击插槽进行放置。",
  "Click a slot to place. Esc to cancel.": "点击插槽放置，按 Esc 取消。",
  "Use ↑↓ keys to move device": "使用 ↑↓ 键移动设备",
  "Drag to resize. Arrow Up grows, Arrow Down shrinks.":
    "拖拽可调整大小。↑ 变大，↓ 变小。",
  "Open the Devices tab on the left and drag devices into your rack.":
    "打开左侧“设备”标签页，把设备拖入机柜。",
  "Open the Devices tab, tap a device to arm it, then tap a rack slot to place it.":
    "打开“设备”标签页，点击设备以激活，再点机柜插槽放置。",
  "Pin device": "固定设备",
  "Pin to top": "置顶",
  Pinned: "已固定",
  "Pinned devices": "已固定的设备",
  "Dismiss hint": "忽略提示",
  "Dismiss notification": "关闭通知",
  "Close dialog": "关闭对话框",
  "Close layout": "关闭布局",
  "Collapse panel": "折叠面板",
  "Collapse left panel": "折叠左侧面板",
  "Collapse right panel": "折叠右侧面板",
  "Edit and view panel": "编辑与视图面板",
  "Clear search": "清除搜索",
  "Search or run a command": "搜索或运行命令",
  "Search or jump to...": "搜索或跳转…",
  Recent: "最近",
  "Finish the current open first": "请先完成当前操作",
  "swap this face for the other one": "与另一面互换",
  "nothing rear-facing here": "此面无背向安装设备",
  "DEV -": "开发 -",
  Project: "项目",
  Branch: "分支",
  Built: "构建于",
  Backed: "后端",
  "Console": "控制台",
  POST: "POST",
  Input: "输入",
  Output: "输出",
  Bidirectional: "双向",
  Male: "公头",
  Female: "母头",

  // ---------------------------------------------------------------- 设备类别
  Server: "服务器",
  Network: "网络",
  Firewall: "防火墙",
  Power: "电源",
  "Patch Panel": "配线架",
  "Cable Management": "理线",
  Shelf: "层板",
  "Blank Panel": "盲板",
  Chassis: "机箱",
  Cooling: "散热",
  "AV/Media": "音视频/媒体",
  Other: "其他",
  // getCategoryDisplayName 的 blank（设备库「盲板」分类，非「空白」）
  Blank: "盲板",

  // ------------------------------------------------------- 帮助面板（关于与快捷键）
  // 分组标题来自 registry 的 HelpGroup，手势行来自 HELP_GESTURE_ROWS
  Navigation: "导航",
  General: "通用",
  Editing: "编辑",
  File: "文件",
  Canvas: "画布",
  "Scroll Wheel": "滚轮",
  "Shift + Scroll": "Shift + 滚轮",
  "Click + Drag": "点击 + 拖拽",
  "Zoom in/out (at cursor)": "缩放（以光标为中心）",
  "Pan horizontally": "水平平移",
  "Pan canvas": "平移画布",
  "Copy for bug report": "复制用于问题反馈",
  "Copied!": "已复制！",
  // 构建信息里的「浏览器」标签（值是 UA 串，不译）
  Browser: "浏览器",
  // registry 里的「保存布局」（另有一条带扩展名的 "Save layout (.yaml)"）
  "Save layout": "保存布局",
  // 设置：清理未使用的自定义设备类型
  Review: "查看",

  // ---------------------------------------------------------------- 端口类型
  "1GbE (RJ45)": "1GbE（RJ45）",
  "1GbE SFP": "1GbE SFP",
  "10GbE (RJ45)": "10GbE（RJ45）",
  "10GbE SFP+": "10GbE SFP+",
  "25GbE SFP28": "25GbE SFP28",
  "40GbE QSFP+": "40GbE QSFP+",
  "100GbE QSFP28": "100GbE QSFP28",
  HDMI: "HDMI",
  DisplayPort: "DisplayPort",
  "SDI (BNC)": "SDI（BNC）",
  "ADAT Optical": "ADAT 光纤",
  "DB25 (TASCAM)": "DB25（TASCAM）",
  "DMX512 (XLR-5)": "DMX512（XLR-5）",
  "MIDI (5-pin DIN)": "MIDI（5 针 DIN）",
  "Phoenix/Euroblock": "Phoenix/Euroblock",
  "RS-232": "RS-232",
  "RS-422": "RS-422",
  Speakon: "Speakon",
  "XLR-5": "XLR-5",
  Dante: "Dante",
  AES3: "AES3",

  // ---------------------------------------------------------------- 机柜形式
  "2-post": "2 柱",
  "4-post": "4 柱",
  "4-post cabinet": "4 柱机柜",
  "Wall mount": "壁挂",
  "Open frame": "开放式机架",
  '19" (Standard)': "19 英寸（标准）",

  // ---------------------------------------------------------------- Rack3D 扩展
  "3D Rack View": "3D 机柜视图",
  "Toggle 3D rack view": "开关 3D 机柜视图",
  "Real-time Data Mapping": "实时数据映射",
  Telemetry: "数据",
  "Telemetry Mapping": "实时数据映射",
  Language: "语言",
  "Switch language": "切换语言",
};

/** 动态文案规则：按顺序匹配，首个命中即返回 */
/**
 * 规则替换值。
 * - string：常规替换，`$1`/`$2` 引用捕获组。
 * - function：函数式替换，入参是**已二次查词**的捕获组，用于插值句子中
 *   夹带英文片段的情况（如 `Storage status: Not exported, Browser`）。
 */
export type RuleReplacement = string | ((...captures: string[]) => string);

/**
 * 命令层用的面别码是**小写** `"front" | "rear"`（见 stores/commands/device.ts），
 * 而 TEXT 表里只有首字母大写的 `Front` / `Rear`（面板标签用）。
 * 这类小写面别只出现在动态拼接串里，为免污染全局 TEXT（`front` 作为独立
 * 文本节点无实义），在规则内部就地映射。
 */
function faceCn(face: string): string {
  return face === "front" ? "正面" : "背面";
}

export const RULES: [RegExp, RuleReplacement][] = [
  // 复数计数
  [/^(\d[\d,]*) devices?$/, "$1 台设备"],
  [/^(\d[\d,]*) racks?$/, "$1 个机柜"],
  // 机柜列表页头：首字母大写的 "N Rack" / "N Racks"
  [/^(\d[\d,]*) Racks?$/, "$1 个机柜"],
  // 机柜列表条目元信息：「12U · 1 device」/「24U · 8 devices」
  [/^(\d+)U\s*·\s*(\d[\d,]*) devices?$/, "$1U · $2 台设备"],
  // 命令面板：从模板新建布局（模板名再经一次查词，如 Home Lab → 家庭实验室）
  [/^New layout from template: (.+)$/, (name: string) => `从模板新建布局：${name}`],
  // 画布无障碍名：机柜/设备总数与设备清单
  [
    /^(\d[\d,]*) racks? with (\d[\d,]*) devices? total$/,
    "共 $1 个机柜、$2 台设备",
  ],
  [
    /^Active rack devices from top to bottom: (.+)$/,
    "活动机柜设备（自上而下）：$1",
  ],
  // 折叠面板条：展开 {Edit|View|…} 面板（面板名再经一次查词）
  [/^Expand (.+) panel$/, (label: string) => `展开${label}面板`],
  // 端口气泡的 PoE 徽标：`PoE Source (PoE+)` / `PoE Powered (802.3af)`
  [/^PoE Source \((.+)\)$/, "PoE 供电（$1）"],
  [/^PoE Powered \((.+)\)$/, "PoE 受电（$1）"],
  [/^(\d[\d,]*) layouts$/, "$1 个布局"],
  [/^(\d[\d,]*) snaps?hots$/, "$1 个快照"],
  [/^(\d[\d,]*) bays?$/, "$1 个并柜"],
  [/^(\d[\d,]*) selected$/, "已选 $1 项"],
  [/^(\d[\d,]*) items?$/, "$1 项"],
  [/^(\d[\d,]*) of (\d[\d,]*)$/, "$1 / $2"],

  // 布局库卡片：首字母大写的计数（上游渲染为 "6 Layouts"）
  [/^(\d[\d,]*) Layouts?$/, "$1 个布局"],
  // 模板摘要 / 布局库元信息：「N 机柜 · M 设备」（中点在或逗号分隔）
  [/^(\d[\d,]*)\s+racks?\s*[·,]\s*(\d[\d,]*)\s+devices?$/, "$1 个机柜 · $2 台设备"],
  // 布局库卡片元信息：状态由 TEXT(Active/Open/Closed) 译出；机柜/设备计数
  // 在上游各自包成独立 span 后命中上面的单复数计数规则。
  // （原「状态·N机柜·M设备」整句合成规则已删：它依赖跨元素合成，会拍平子结构。）

  // 历史 / 通知
  // ⚠️ 这里的撤销/重做描述必须用**函数式替换**：描述串里嵌着对象名
  // （如 `Duplicate rack "机柜 A"`），函数式替换会把捕获组**再查一次词典**，
  // 而字符串替换（"已撤销：$1"）只做纯文本拼接，会留下半截英文。
  [/^Undid: (.+)$/, (desc: string) => `已撤销：${desc}`],
  [/^Redid: (.+)$/, (desc: string) => `已重做：${desc}`],
  [/^Saved (.+)$/, "已保存 $1"],
  [/^Delete "(.+)"\?$/, "删除 “$1”？"],
  // ⚠️ 捕获组必须只咬住数字：原文是 `This device is placed 2 times.`，
  // 若写成 (.+) 会把 "2 times" 整个吞掉，译出来就成了「已被放置 2 times 次」。
  [
    /^Delete "(.+)"\? This device is placed (\d+) times?\. All instances will be removed\.$/,
    "删除 “$1”？该设备已被放置 $2 次，所有实例都将被移除。",
  ],
  [
    /^Delete "(.+)"\? This will remove the device from your library\.$/,
    "删除 “$1”？这将从设备库中移除该设备。",
  ],
  // 确认弹窗（ConfirmDialog）正文：模板是英文，而机柜/布局/设备名常是中文，
  // 拼接后就是「英文 + 中文变量」的混合串（如 `Delete "机柜"? …`）。
  // 这类串不会命中 TEXT（TEXT 的键全是纯英文），必须由 RULES 收口；
  // 捕获组用函数式替换再查一次词典，变量里的英文片段也能一并译掉。
  [
    /^Delete "(.+)"\? This removes it from your library and cannot be undone\.$/,
    (name: string) =>
      `删除 “${name}”？此操作会将其从布局库中移除，且无法撤销。`,
  ],
  [
    /^Delete "(.+)"\? All bays will be removed\.$/,
    (name: string) => `删除 “${name}”？所有并柜都将被移除。`,
  ],
  [
    /^Delete "(.+)"\? This will remove (\d+) devices? across all bays\.$/,
    (name: string, count: string) =>
      `删除 “${name}”？将移除全部并柜中的 ${count} 台设备。`,
  ],
  [
    /^Remove all (\d+) devices? from this rack\? This action can be undone\.$/,
    (count: string) => `移除该机柜的全部 ${count} 台设备？此操作可以撤销。`,
  ],
  [
    /^Are you sure you want to delete "(.+)"\? This cannot be undone\.$/,
    (name: string) => `确定要删除 “${name}” 吗？此操作无法撤销。`,
  ],
  [
    /^Are you sure you want to delete "(.+)"\? (\d+) devices? will be removed\.$/,
    (name: string, count: string) =>
      `确定要删除 “${name}” 吗？将移除 ${count} 台设备。`,
  ],
  [
    /^Are you sure you want to delete "(.+)"\?$/,
    (name: string) => `确定要删除 “${name}” 吗？`,
  ],
  [/^Delete layout "(.+)"\?$/, "删除布局 “$1”？"],
  [/^Rename "(.+)"$/, "重命名 “$1”"],
  // 布局库操作结果提示（对象名可能是中文，故用函数式替换再查一次词）
  [/^Closed "(.+)"$/, (name: string) => `已关闭 “${name}”`],
  [/^Deleted "(.+)" \((\d+) devices? removed\)$/, (name: string, n: string) =>
    `已删除 “${name}”（含 ${n} 台设备）`],
  [/^Deleted "(.+)"$/, (name: string) => `已删除 “${name}”`],
  [/^Could not delete "(.+)"$/, (name: string) => `无法删除 “${name}”`],
  [/^Cannot duplicate "(.+)"$/, (name: string) => `无法复制 “${name}”`],
  [/^Duplicated as "(.+)"$/, (name: string) => `已复制为 “${name}”`],
  // 设备库导入 / YAML 应用
  [/^"(.+)" added to Devices$/, (name: string) => `已将 “${name}” 添加到设备库`],
  [/^Imported "(.+)" to Devices$/, (name: string) =>
    `已将 “${name}” 导入设备库`],
  [
    /^Imported (\d+) devices \((\d+) skipped\)$/,
    (n: string, skipped: string) => `已导入 ${n} 台设备（跳过 ${skipped} 台）`,
  ],
  [/^Imported (\d+) devices?$/, (n: string) => `已导入 ${n} 台设备`],
  // 设备上/下移被阻挡的轻提示（device-movement.getMoveBlockedMessage）
  [
    /^Already at the (top|bottom) of the rack$/,
    (edge: string) => `已到机柜${edge === "top" ? "顶部" : "底部"}`,
  ],
  [
    /^No free slot to move (up|down)$/,
    (dir: string) => `没有空位可以${dir === "up" ? "上移" : "下移"}`,
  ],
  [/^Import failed: (.+)$/, (err: string) => `导入失败：${err}`],
  [/^"(.+)" is corrupted and cannot be opened$/, (name: string) =>
    `“${name}” 已损坏，无法打开`],
  [
    /^Applied with (\d+) images? that couldn't be read$/,
    (n: string) => `已应用，其中 ${n} 张图片无法读取`,
  ],
  [
    /^Layout loaded with (\d+) images? that couldn't be read$/,
    (n: string) => `布局已加载，其中 ${n} 张图片无法读取`,
  ],
  [
    /^(\d+) images? exceed 100KB; consider optimising them to keep files small\.$/,
    (n: string) => `有 ${n} 张图片超过 100KB，建议压缩以减小文件体积。`,
  ],
  // 历史描述里嵌的是小写面别（front / rear）
  [
    /^Cannot flip to (front|rear): the face is blocked$/,
    (face: string) => `无法翻转到${faceCn(face)}：该面已被占用`,
  ],
  [/^Exported a copy of (\d+) layouts?$/, (n: string) => `已导出 ${n} 个布局的副本`],
  // 服务器模式的连通性提示（本地浏览器模式不会出现）
  [/^Reconnected to (.+)\.$/, (name: string) => `已重新连接 ${name}。`],
  [
    /^Can't reach (.+) to export\. Reload to retry\.$/,
    (name: string) => `无法连接 ${name} 进行导出。重新加载可重试。`,
  ],

  // 尺寸 / 单位 / 显示
  [/^Height \((\d+)U\)$/, "高度（$1U）"],
  [/^Zoom level (\d+) percent$/, "缩放级别 $1%"],
  [/^Display: (.+)$/, "显示：$1"],
  [/^(\d[\d,]*)\/(\d[\d,]*)U used$/, "已用 $1/$2U"],
  [/^(\d[\d,]*)% used$/, "已用 $1%"],

  // 相对时间
  [/^(\d+) seconds? ago$/, "$1 秒前"],
  [/^(\d+) minutes? ago$/, "$1 分钟前"],
  [/^(\d+) hours? ago$/, "$1 小时前"],
  [/^(\d+) days? ago$/, "$1 天前"],
  [/^just now$/, "刚刚"],

  // 含插值的整句：上游把变量插在句子中间（如 `No {face}-facing devices yet.`），
  // DOM 上是多个文本节点，必须按整句匹配才能译全。
  [
    /^No front-facing or full-depth devices yet\. Drag one in\.$/,
    "暂无正面或全深设备，拖入一台即可。",
  ],
  [
    /^No rear-facing or full-depth devices yet\. Drag one in\.$/,
    "暂无背面或全深设备，拖入一台即可。",
  ],

  // 存储状态无障碍名：标签本身是英文词条，靠函数式替换做二次查词
  [
    /^Storage status: (.+), (.+)$/,
    (label: string, place: string) => `存储状态：${label} · ${place}`,
  ],
  [/^Storage status: (.+)$/, (label: string) => `存储状态：${label}`],

  // ------------------------------------------------- 撤销/重做气泡与历史描述
  // 撤销/重做按钮的悬浮气泡文案是 `Undo: <描述>`，描述由命令层动态拼出。
  // 放在 RULES 末尾（兜底规则之前）：既要晚于「重命名 "X"」这类带引号规则，
  // 又要早于句末句点兜底。通用动词规则（Place/Move/Remove…）之所以敢放开，
  // 是因为所有**同名界面标签**（如 Move device up / Remove selected / Add Device）
  // 都已在 TEXT 精确表里，TEXT 优先命中，不会被这里劫持。
  [/^Undo: (.+)$/, (desc: string) => `撤销：${desc}`],
  [/^Redo: (.+)$/, (desc: string) => `重做：${desc}`],
  [/^Duplicate rack "(.+)"$/, (name: string) => `复制机柜 “${name}”`],
  [/^Remove (\d+) connections?$/, (n: string) => `移除 ${n} 条链路`],
  [/^Set bay count to (\d+)$/, (n: string) => `并柜数量设为 ${n}`],
  [
    /^Update (.+) (front|rear) image$/,
    (name: string, face: string) => `更新 ${name} 的${faceCn(face)}图片`,
  ],
  [/^Flipped to (front|rear)$/, (face: string) => `已翻转到${faceCn(face)}`],
  // 设备属性面板：切换安装面被占用时的提示，face 可能是 full-depth
  [
    /^Cannot change to (front|rear|full-depth): blocked by (.+)$/,
    (face: string, names: string) =>
      `无法切换为${face === "full-depth" ? "全深" : faceCn(face)}：与 ${names} 冲突`,
  ],
  [/^Active: (.+)$/, (name: string) => `当前机柜：${name}`],
  [/^Add rack "(.+)"$/, "新增机柜 “$1”"],
  [/^Delete rack "(.+)"$/, "删除机柜 “$1”"],
  [/^Create rack group "(.+)"$/, "新建机柜分组 “$1”"],
  [/^Update rack group "(.+)"$/, "更新机柜分组 “$1”"],
  [/^Delete rack group "(.+)"$/, "删除机柜分组 “$1”"],
  [/^Clear rack \((.+)\)$/, (devices: string) => `清空机柜（${devices}）`],
  [/^Update rack settings$/, "更新机柜设置"],
  [/^Replace rack$/, "替换机柜"],
  [/^Add connection$/, "新增链路"],
  [/^Update connection$/, "更新链路"],
  [/^Remove connection$/, "移除链路"],
  [/^Move (.+) to another rack$/, "将 $1 移到另一机柜"],
  [/^Move (.+) to another cell$/, "将 $1 移到另一格"],
  [/^Remove (.+) and its contents$/, "移除 $1 及其内容"],
  [/^Detach (.+) from container$/, "将 $1 从载板拆下"],
  [/^Update (.+) image$/, "更新 $1 的图片"],
  [/^Update (.+) colour$/, "更新 $1 的颜色"],
  [/^Update (.+) notes$/, "更新 $1 的备注"],
  [/^Update (.+) IP$/, "更新 $1 的 IP"],
  [/^Place (.+)$/, "放置 $1"],
  [/^Move (.+)$/, "移动 $1"],
  [/^Remove (.+)$/, "移除 $1"],
  [/^Flip (.+)$/, "翻转 $1"],
  [/^Rename (.+)$/, "重命名 $1"],
  [/^Update (.+)$/, "更新 $1"],
  [/^Add (.+)$/, "新增 $1"],
  [/^Delete (.+)$/, "删除 $1"],

  // ------------------------------------------------- 构建信息 / 开发版提示
  // buildTime.formatRelativeTime 输出的是**短写**（"58 min" / "2 hours" / "1 day"），
  // 后面再接 " ago"（Svelte 会合并成一个文本节点 "58 min ago"）。
  [/^(\d+) min ago$/, "$1 分钟前"],
  [/^< 1 min ago$/, "不到 1 分钟前"],
  // dev-build-toast：`Dev build v26.9.0 (built 58 min ago)`，
  // 带 commit 时是 `Dev build v26.5.0 (9e14975e, built 23 min ago)`。
  [
    /^Dev build v([\d.]+) \((.+), built (.+)\)$/,
    (ver: string, hash: string, built: string) =>
      `开发版 v${ver}（${hash}，构建于 ${built}）`,
  ],
  [
    /^Dev build v([\d.]+) \(built (.+)\)$/,
    (ver: string, built: string) => `开发版 v${ver}（构建于 ${built}）`,
  ],
  [/^Dev build v([\d.]+)$/, (ver: string) => `开发版 v${ver}`],

  // ------------------------------------------------- 品牌 / 页脚
  // LogoLockup 的 aria-label：开发环境下前置一个 D（dev 前缀）
  [/^(?:D)?Rackula - development environment$/, "Rackula - 开发环境"],
  // 关于面板页脚（emoji 原样保留：捕获组里的 emoji 查不到词条，会被原样带回）
  [/^Made in Canada (.+) with (.+)$/, "加拿大制造 $1，满怀 $2"],

  // 兜底：句末带句点的整句。去掉句点后二次查词，只有真的译出来了才换成中文句号，
  // 否则原样返回（未命中词典的英文文案不应被硬加句号）。
  [
    /^(.+)\.$/,
    (inner: string) =>
      /[\u4e00-\u9fff]/.test(inner) ? `${inner}。` : `${inner}.`,
  ],
];

/**
 * 不参与翻译的英文白名单（品牌、专有名词、代号等）。
 * 命中则原样保留，避免误翻。
 */
export const KEEP_AS_IS: readonly string[] = [
  "Rackula",
  "Rack3D",
  "NetBox",
  "GitHub",
  "MIT",
  "PNG",
  "JPEG",
  "SVG",
  "PDF",
  "YAML",
  "JSON",
  "CSV",
  "ZIP",
  "LED",
  "PDU",
  "UPS",
  "KVM",
  "SFP",
  "RJ45",
  "QSFP",
  "PoE",
  "LAG",
  "DMX",
  "XLR",
  "TRS",
  "RCA",
  "BNC",
  "MIDI",
  "HDMI",
  "AVB",
  "OPC-UA",
  "Modbus",
  "MQTT",
  "SNMP",
  "Docker",
  "Svelte",
  "Three.js",
  "GLTF",
  "GLB",
  "C13",
  "EIA-310",
];
