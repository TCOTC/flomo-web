import {
    Plugin,
    Setting,
    showMessage,
} from "siyuan";
import {
    applyConfig,
    clearConfigPanels,
    DEFAULT_CONFIG,
    type FlomoConfig,
    normalizeConfig,
    STORAGE_NAME,
} from "./config";
import {registerFlomoDock} from "./dock";
import type zhCN from "./i18n/zh-CN.json";
import "./index.scss";
import {bindFlomoPaste} from "./paste";
import {
    ensureSession,
    parseSessionId,
    peekSessionPartition,
    sessionPartition,
    STORAGE_SESSION,
} from "./session";
import {
    bindFlomoOpenLink,
    emptyOpenFlomoTabs,
    hydrateOpenFlomoTabs,
    openFlomoTab,
    registerFlomoTab,
} from "./tab";
import {
    disposeFlomoCovers,
    disposeGuestDevtoolsHook,
} from "./view";

// flomo 官方图形标路径，停靠栏用 currentColor 跟随主题
const ICON_SVG =
    '<symbol id="iconFlomoWeb" viewBox="99 99 314 314"><path fill="currentColor" d="M370.13 209.043L342.32 255.42h-85.144c5.55 11.177 8.672 23.774 8.672 37.102 0 46.104-37.35 83.478-83.425 83.478C136.35 376 99 338.626 99 292.522c0-46.104 37.35-83.479 83.424-83.479 1.948 0 3.88.067 5.794.199v-.199zM182.423 255.42c-20.477 0-37.077 16.611-37.077 37.102 0 20.49 16.6 37.101 37.077 37.101 20.478 0 37.078-16.61 37.078-37.101 0-20.49-16.6-37.102-37.078-37.102zM413 136l-27.808 46.377H231.089L258.897 136z"/></symbol><symbol id="iconFlomoWebHome" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z"/></symbol><symbol id="iconFlomoWebDevtools" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 10l-2 2 2 2M16 10l2 2-2 2M13 9l-2 6"/></symbol>';

export default class FlomoWebPlugin extends Plugin {
    declare i18n: typeof zhCN;
    private unbindOpenLink?: () => void;
    private unbindPaste?: () => void;
    private config: FlomoConfig = {...DEFAULT_CONFIG};
    /** onload / onDataChanged / onunload 会交错触发 loadData，用票据丢弃过期回调 */
    private configTicket = 0;

    onload() {
        this.addIcons(ICON_SVG);
        void ensureSession(this);
        registerFlomoDock(this);
        registerFlomoTab(this);
        hydrateOpenFlomoTabs(this);
        this.syncOpenLink();
        this.unbindPaste = bindFlomoPaste(this);
        this.setupSetting();
        this.loadConfig();

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

    /** 存储数据变更（如同步）。覆盖默认实现，避免整插件重载导致页签抖动 */
    onDataChanged() {
        this.loadConfig();

        console.log(this.displayName, "plugin config changed");
    }

    onunload() {
        // 作废进行中的 loadConfig，避免卸载后回调又 applyConfig
        this.configTicket++;
        this.unbindOpenLink?.();
        this.unbindOpenLink = undefined;
        this.unbindPaste?.();
        this.unbindPaste = undefined;
        emptyOpenFlomoTabs(this);
        disposeFlomoCovers();
        clearConfigPanels();
        disposeGuestDevtoolsHook();

        console.log(this.displayName, "plugin unloaded");
    }

    uninstall() {
        void this.clearFlomoSession();

        console.log(this.displayName, "plugin uninstalled");
    }

    /** 先读到当前工作空间的 partition 再清 cookie，避免删文件后找不到桶 */
    private async clearFlomoSession() {
        let partition = peekSessionPartition();
        if (!partition) {
            try {
                const sid = parseSessionId(await this.loadData(STORAGE_SESSION));
                if (sid) {
                    partition = sessionPartition(sid);
                }
            } catch (e) {
                const errorMessage = `${this.displayName}: failed to load data [${STORAGE_SESSION}]: ${
                    (e as {msg?: string;}).msg || e
                }`;
                showMessage(errorMessage);
                console.error(errorMessage);
            }
        }
        if (partition) {
            try {
                const remote = (window as any).require?.("@electron/remote");
                remote?.session?.fromPartition(partition)?.clearStorageData?.();
            } catch (e) {
                console.error(`${this.displayName}: failed to clear flomo session`, e);
            }
        }
        const remove = (name: string) => {
            this.removeData(name).catch((e) => {
                const errorMessage = `${this.displayName}: failed to uninstall remove data [${name}]: ${e.msg || e}`;
                showMessage(errorMessage);
                console.error(errorMessage);
            });
        };
        remove(STORAGE_SESSION);
        remove(STORAGE_NAME);
    }

    private loadConfig() {
        const ticket = ++this.configTicket;
        this.loadData(STORAGE_NAME).then((data) => {
            if (ticket !== this.configTicket) {
                return;
            }
            this.config = normalizeConfig(data);
            applyConfig(this.config);
            this.syncOpenLink();
        }).catch((e) => {
            if (ticket !== this.configTicket) {
                return;
            }
            const errorMessage = `${this.displayName}: failed to load data [${STORAGE_NAME}]: ${e.msg || e}`;
            showMessage(errorMessage);
            console.error(errorMessage);
        });
    }

    private setupSetting() {
        let draft: FlomoConfig | undefined;
        const takeDraft = () => {
            if (!draft) {
                draft = {...this.config};
            }
            return draft;
        };
        this.setting = new Setting({
            width: "520px",
            height: "auto",
            destroyCallback: () => {
                draft = undefined;
            },
            confirmCallback: () => {
                if (!draft) {
                    return;
                }
                this.config = {...draft};
                applyConfig(this.config);
                this.syncOpenLink();
                this.saveData(STORAGE_NAME, this.config).catch((e) => {
                    const errorMessage = `${this.displayName}: failed to save data [${STORAGE_NAME}]: ${e.msg || e}`;
                    showMessage(errorMessage);
                    console.error(errorMessage);
                });
            },
        });
        this.addSwitch(this.i18n.immersiveTab, this.i18n.immersiveTabDesc, "immersiveTab", takeDraft);
        this.addSwitch(this.i18n.immersiveDock, this.i18n.immersiveDockDesc, "immersiveDock", takeDraft);
        this.addSwitch(
            this.i18n.interceptEditorFlomoLinks,
            this.i18n.interceptEditorFlomoLinksDesc,
            "interceptEditorFlomoLinks",
            takeDraft,
        );
        this.addSwitch(this.i18n.showDevToolsButton, this.i18n.showDevToolsButtonDesc, "showDevToolsButton", takeDraft);
    }

    /** 仅在配置启用时监听 open-link，拦截编辑器中的 flomo 链接 */
    private syncOpenLink() {
        if (this.config.interceptEditorFlomoLinks) {
            if (!this.unbindOpenLink) {
                this.unbindOpenLink = bindFlomoOpenLink(this);
            }
            return;
        }
        this.unbindOpenLink?.();
        this.unbindOpenLink = undefined;
    }

    private addSwitch(
        title: string,
        description: string,
        key: keyof FlomoConfig,
        takeDraft: () => FlomoConfig,
    ) {
        this.setting.addItem({
            title,
            description,
            createActionElement: () => {
                const current = takeDraft();
                const input = document.createElement("input");
                input.className = "b3-switch fn__flex-center";
                input.type = "checkbox";
                input.checked = current[key];
                input.addEventListener("change", () => {
                    current[key] = input.checked;
                });
                return input;
            },
        });
    }
}
