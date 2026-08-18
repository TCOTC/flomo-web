import {
    Plugin,
    Setting,
    showMessage,
} from "siyuan";
import {
    applyImmersiveTab,
    DEFAULT_CONFIG,
    type FlomoConfig,
    normalizeConfig,
    STORAGE_NAME,
} from "./config";
import {registerFlomoDock} from "./dock";
import type zhCN from "./i18n/zh-CN.json";
import "./index.scss";
import {
    bindFlomoLinkClicks,
    openFlomoTab,
    registerFlomoTab,
} from "./tab";
import {WEBVIEW_PARTITION} from "./view";

// flomo 官方图形标路径，停靠栏用 currentColor 跟随主题
const ICON_SVG =
    '<symbol id="iconFlomoWeb" viewBox="99 99 314 314"><path fill="currentColor" d="M370.13 209.043L342.32 255.42h-85.144c5.55 11.177 8.672 23.774 8.672 37.102 0 46.104-37.35 83.478-83.425 83.478C136.35 376 99 338.626 99 292.522c0-46.104 37.35-83.479 83.424-83.479 1.948 0 3.88.067 5.794.199v-.199zM182.423 255.42c-20.477 0-37.077 16.611-37.077 37.102 0 20.49 16.6 37.101 37.077 37.101 20.478 0 37.078-16.61 37.078-37.101 0-20.49-16.6-37.102-37.078-37.102zM413 136l-27.808 46.377H231.089L258.897 136z"/></symbol><symbol id="iconFlomoWebHome" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z"/></symbol><symbol id="iconFlomoWebDevtools" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 10l-2 2 2 2M16 10l2 2-2 2M13 9l-2 6"/></symbol>';

export default class FlomoWebPlugin extends Plugin {
    declare i18n: typeof zhCN;
    private unbindLinkClicks?: () => void;
    private config: FlomoConfig = {...DEFAULT_CONFIG};

    onload() {
        this.addIcons(ICON_SVG);
        registerFlomoDock(this);
        registerFlomoTab(this);
        this.unbindLinkClicks = bindFlomoLinkClicks(this);
        this.setupSetting();
        this.loadData(STORAGE_NAME).then((data) => {
            this.config = normalizeConfig(data);
            applyImmersiveTab(this.config.immersiveTab);
        }).catch((e) => {
            const errorMessage = `${this.displayName}: failed to load data [${STORAGE_NAME}]: ${e.msg || e}`;
            showMessage(errorMessage);
            console.error(errorMessage);
        });
        console.log(this.displayName, "plugin loaded");
    }

    onLayoutReady() {
        this.addTopBar({
            icon: "iconFlomoWeb",
            title: this.i18n.openTab,
            position: "left",
            callback: () => {
                openFlomoTab(this);
            },
        });
        this.addCommand({
            langKey: "openTab",
            langText: this.i18n.openTab,
            hotkey: "",
            callback: () => {
                openFlomoTab(this);
            },
        });
    }

    onunload() {
        this.unbindLinkClicks?.();
        this.unbindLinkClicks = undefined;
        console.log(this.displayName, "plugin unloaded");
    }

    uninstall() {
        try {
            const remote = (window as any).require?.("@electron/remote");
            remote?.session?.fromPartition(WEBVIEW_PARTITION)?.clearStorageData?.();
        } catch (e) {
            console.error(`${this.displayName}: failed to clear flomo session`, e);
        }
        this.removeData(STORAGE_NAME).catch((e) => {
            const errorMessage = `${this.displayName}: failed to uninstall remove data [${STORAGE_NAME}]: ${
                e.msg || e
            }`;
            showMessage(errorMessage);
            console.error(errorMessage);
        });
        console.log(this.displayName, "plugin uninstalled");
    }

    private setupSetting() {
        let draft: FlomoConfig = {...this.config};
        this.setting = new Setting({
            width: "520px",
            height: "auto",
            confirmCallback: () => {
                this.config = {...draft};
                applyImmersiveTab(this.config.immersiveTab);
                this.saveData(STORAGE_NAME, this.config).catch((e) => {
                    const errorMessage = `${this.displayName}: failed to save data [${STORAGE_NAME}]: ${e.msg || e}`;
                    showMessage(errorMessage);
                    console.error(errorMessage);
                });
            },
        });
        this.setting.addItem({
            title: this.i18n.immersiveTab,
            description: this.i18n.immersiveTabDesc,
            createActionElement: () => {
                draft = {...this.config};
                const input = document.createElement("input");
                input.className = "b3-switch fn__flex-center";
                input.type = "checkbox";
                input.checked = draft.immersiveTab;
                input.addEventListener("change", () => {
                    draft.immersiveTab = input.checked;
                });
                return input;
            },
        });
    }
}
