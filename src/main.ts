import App from "./App.svelte";
import "./app.css";
import { mount } from "svelte";
// Rack3D 扩展：启动运行期汉化词典层（zh-CN 为默认语言）
import { initI18n } from "$lib/i18n";
// Rack3D 扩展：挂载前应用持久化的界面配色方案，避免默认配色闪现
import { initAppThemeAttribute } from "$lib/stores/ui.svelte";
// Rack3D 扩展：页签标题中文化
import { applyDocumentTitle } from "$lib/i18n/app-chrome";

initAppThemeAttribute();

const app = mount(App, {
  target: document.getElementById("app")!,
});

// 在首次绘制前完成翻译，避免英文闪现（mount 是同步的，此处仍在同一帧内）
initI18n();

// 页签标题中文化。放在 mount() 之后调用：上游 PersistenceEffects 在 onMount
// 里给标题拼 "LOCAL - " / "DEV - " 前缀，这里设一次并持续兜住后续改写。
applyDocumentTitle();

export default app;
