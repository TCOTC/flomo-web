import {Plugin} from "siyuan";
import {
    registerFlomoDock,
    WEBVIEW_PARTITION,
} from "./dock";
import type zhCN from "./i18n/zh-CN.json";
import "./index.scss";

const ICON_SVG =
    '<symbol id="iconFlomoWeb" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></symbol><symbol id="iconFlomoWebHome" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z"/></symbol><symbol id="iconFlomoWebDevtools" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 10l-2 2 2 2M16 10l2 2-2 2M13 9l-2 6"/></symbol>';

export default class FlomoWebPlugin extends Plugin {
    declare i18n: typeof zhCN;

    onload() {
        this.addIcons(ICON_SVG);
        registerFlomoDock(this);
        console.log(this.displayName, "plugin loaded");
    }

    onunload() {
        console.log(this.displayName, "plugin unloaded");
    }

    uninstall() {
        try {
            const remote = (window as any).require?.("@electron/remote");
            remote?.session?.fromPartition(WEBVIEW_PARTITION)?.clearStorageData?.();
        } catch (e) {
            console.error(`${this.displayName}: failed to clear flomo session`, e);
        }
        console.log(this.displayName, "plugin uninstalled");
    }
}
