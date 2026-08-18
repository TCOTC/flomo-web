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

let immersiveTab = DEFAULT_CONFIG.immersiveTab;
let showDevToolsButton = DEFAULT_CONFIG.showDevToolsButton;

export function normalizeConfig(data: unknown): FlomoConfig {
    const raw = data && typeof data === "object" ? data as Record<string, unknown> : {};
    return {
        immersiveTab: raw.immersiveTab !== false,
        showDevToolsButton: raw.showDevToolsButton === true,
    };
}

/** 按配置切换相关元素的 fn__none，已打开的面板会立刻跟上 */
export function applyConfig(config: FlomoConfig = {immersiveTab, showDevToolsButton}) {
    immersiveTab = config.immersiveTab;
    showDevToolsButton = config.showDevToolsButton;
    document.querySelectorAll(".flomo-web--tab > .block__icons").forEach((el) => {
        el.classList.toggle("fn__none", immersiveTab);
    });
    document.querySelectorAll('.flomo-web [data-type="devtools"]').forEach((el) => {
        el.classList.toggle("fn__none", !showDevToolsButton);
        const prev = el.previousElementSibling;
        if (prev?.classList.contains("fn__space")) {
            prev.classList.toggle("fn__none", !showDevToolsButton);
        }
    });
}
