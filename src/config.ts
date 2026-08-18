export const STORAGE_NAME = "config.json";

export interface FlomoConfig {
    /** 隐藏页签内的工具栏，让网页铺满页签 */
    immersiveTab: boolean;
}

export const DEFAULT_CONFIG: FlomoConfig = {
    immersiveTab: true,
};

let immersiveTab = DEFAULT_CONFIG.immersiveTab;

export function normalizeConfig(data: unknown): FlomoConfig {
    const raw = data && typeof data === "object" ? data as Record<string, unknown> : {};
    return {
        immersiveTab: raw.immersiveTab !== false,
    };
}

export function getImmersiveTab(): boolean {
    return immersiveTab;
}

/** 只改页签根节点上的 data 属性，已打开的页签会立刻跟上 */
export function applyImmersiveTab(enabled: boolean) {
    immersiveTab = enabled;
    document.querySelectorAll(".flomo-web--tab").forEach((el) => {
        el.setAttribute("data-immersive-tab", enabled ? "true" : "false");
    });
}
