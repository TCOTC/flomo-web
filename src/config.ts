export const STORAGE_NAME = "config.json";

export interface FlomoConfig {
    /** 隐藏页签内的工具栏，让网页铺满页签 */
    immersiveTab: boolean;
    /** 在工具栏显示开发者工具按钮 */
    showDevToolsButton: boolean;
}

export const DEFAULT_CONFIG: FlomoConfig = {
    immersiveTab: true,
    showDevToolsButton: false,
};

const CLS_IMMERSIVE = "flomo-web--immersive";
const CLS_SHOW_DEVTOOLS = "flomo-web--show-devtools";

let current: FlomoConfig = {...DEFAULT_CONFIG};
const panels = new Set<HTMLElement>();

function asBoolean(value: unknown, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
}

export function normalizeConfig(data: unknown): FlomoConfig {
    const raw = data && typeof data === "object" ? data as Record<string, unknown> : {};
    return {
        immersiveTab: asBoolean(raw.immersiveTab, DEFAULT_CONFIG.immersiveTab),
        showDevToolsButton: asBoolean(raw.showDevToolsButton, DEFAULT_CONFIG.showDevToolsButton),
    };
}

function paintPanel(panel: HTMLElement) {
    if (panel.classList.contains("flomo-web--tab")) {
        panel.classList.toggle(CLS_IMMERSIVE, current.immersiveTab);
    }
    panel.classList.toggle(CLS_SHOW_DEVTOOLS, current.showDevToolsButton);
}

export function registerConfigPanel(panel: HTMLElement) {
    panels.add(panel);
    paintPanel(panel);
}

export function unregisterConfigPanel(panel: HTMLElement) {
    panels.delete(panel);
}

export function applyConfig(config: FlomoConfig) {
    current = config;
    panels.forEach(paintPanel);
}

export function clearConfigPanels() {
    panels.clear();
}
