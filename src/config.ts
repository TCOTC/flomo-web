export const STORAGE_NAME = "config.json";

export interface FlomoConfig {
    /** 隐藏页签内的工具栏，让网页铺满页签 */
    immersiveTab: boolean;
    /** 隐藏停靠栏内的工具栏，让网页铺满停靠栏 */
    immersiveDock: boolean;
    /** 拦截编辑器中的 flomo 链接，用插件页签打开 */
    interceptEditorFlomoLinks: boolean;
    /** 在工具栏显示开发者工具按钮 */
    showDevToolsButton: boolean;
}

export const DEFAULT_CONFIG: FlomoConfig = {
    immersiveTab: true,
    immersiveDock: false,
    interceptEditorFlomoLinks: true,
    showDevToolsButton: false,
};

const CLS_IMMERSIVE = "flomo-web--immersive";
const CLS_SHOW_DEVTOOLS = "flomo-web--show-devtools";
/** 标记当前 guest 是否按“显示开发者工具按钮”创建；不读 webpreferences 属性，Electron 解析后可能丢掉它 */
export const ATTR_DEVTOOLS = "data-flomo-devtools";

let current: FlomoConfig = {...DEFAULT_CONFIG};
const panels = new Set<HTMLElement>();

function asBoolean(value: unknown, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
}

export function normalizeConfig(data: unknown): FlomoConfig {
    const raw = data && typeof data === "object" ? data as Record<string, unknown> : {};
    return {
        immersiveTab: asBoolean(raw.immersiveTab, DEFAULT_CONFIG.immersiveTab),
        immersiveDock: asBoolean(raw.immersiveDock, DEFAULT_CONFIG.immersiveDock),
        interceptEditorFlomoLinks: asBoolean(raw.interceptEditorFlomoLinks, DEFAULT_CONFIG.interceptEditorFlomoLinks),
        showDevToolsButton: asBoolean(raw.showDevToolsButton, DEFAULT_CONFIG.showDevToolsButton),
    };
}

function paintPanel(panel: HTMLElement) {
    const immersive = panel.classList.contains("flomo-web--tab")
        ? current.immersiveTab
        : current.immersiveDock;
    panel.classList.toggle(CLS_IMMERSIVE, immersive);
    panel.classList.toggle(CLS_SHOW_DEVTOOLS, current.showDevToolsButton);
    const view = panel.querySelector("webview.flomo-web__webview");
    if (view && (view.getAttribute(ATTR_DEVTOOLS) === "1") !== current.showDevToolsButton) {
        panel.dispatchEvent(new Event("flomo-web-devtools-pref"));
    }
}

export function registerConfigPanel(panel: HTMLElement) {
    panels.add(panel);
    paintPanel(panel);
}

export function unregisterConfigPanel(panel: HTMLElement) {
    panels.delete(panel);
}

export function applyConfig(config: FlomoConfig) {
    current = {...config};
    panels.forEach(paintPanel);
}

export function getConfig(): FlomoConfig {
    return current;
}

export function clearConfigPanels() {
    panels.clear();
}
