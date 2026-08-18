import {
    adaptHotkey,
    getFrontend,
} from "siyuan";
import type {Plugin} from "siyuan";
import {getImmersiveTab} from "./config";
import type zhCN from "./i18n/zh-CN.json";
import {getFlomoInjectScript} from "./inject";

export const FLOMO_URL = "https://v.flomoapp.com";
export const DOCK_TYPE = "flomo";
export const TAB_TYPE = "tab";
export const WEBVIEW_PARTITION = "persist:flomo-web";

export type FlomoPlugin = Plugin & {i18n: typeof zhCN;};

export interface WebviewEl extends HTMLElement {
    src: string;
    reload: () => void;
    goBack: () => void;
    goForward: () => void;
    canGoBack: () => boolean;
    canGoForward: () => boolean;
    getURL: () => string;
    openDevTools: () => void;
    closeDevTools: () => void;
    isDevToolsOpened: () => boolean;
    executeJavaScript: (code: string) => Promise<unknown>;
}

export function isElectronDesktop(): boolean {
    const frontEnd = getFrontend();
    return frontEnd === "desktop" || frontEnd === "desktop-window";
}

/** 解析 flomo 网页链接，非 flomo 域名返回空字符串 */
export function parseFlomoUrl(raw: string): string {
    const href = raw.replace(/&amp;/g, "&").trim();
    try {
        const url = new URL(href);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
            return "";
        }
        const host = url.hostname.toLowerCase();
        if (host !== "flomoapp.com" && host !== "v.flomoapp.com" && !host.endsWith(".flomoapp.com")) {
            return "";
        }
        return url.href;
    } catch {
        return "";
    }
}

function escapeAttr(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function iconButton(type: string, href: string, label: string): string {
    return `<span data-type="${type}" class="block__icon ariaLabel" data-position="north" aria-label="${label}"><svg><use xlink:href="${href}"></use></svg></span>`;
}

function joinIcons(icons: string[]): string {
    return icons.join(`
        <span class="fn__space"></span>
        `);
}

export function mountFlomoPanel(options: {
    root: HTMLElement;
    plugin: FlomoPlugin;
    url: string;
    showMin?: boolean;
    isTab?: boolean;
    onTitle?: (title: string) => void;
    onUrl?: (url: string) => void;
}): () => void {
    const {root, plugin, showMin} = options;
    const i18n = plugin.i18n;
    const cleanups: Array<() => void> = [];
    let webview: WebviewEl | null = null;
    let cover: HTMLElement | null = null;
    const tabClass = options.isTab ? " flomo-web--tab" : "";
    const immersiveAttr = options.isTab ? ` data-immersive-tab="${getImmersiveTab() ? "true" : "false"}"` : "";

    const minBtn = showMin ? iconButton("min", "#iconMin", `${i18n.min} ${adaptHotkey("⌘W")}`) : "";

    if (!isElectronDesktop()) {
        root.innerHTML = `<div class="fn__flex-1 fn__flex-column flomo-web${tabClass}"${immersiveAttr}>
    <div class="block__icons">
        <div class="block__logo fn__flex-1">
            <svg class="block__logoicon"><use xlink:href="#iconFlomoWeb"></use></svg>${i18n.dockTitle}
        </div>
        ${minBtn}
    </div>
    <div class="b3-typography flomo-web__fallback">${i18n.desktopOnly}</div>
</div>`;
        return () => undefined;
    }

    const startSrc = parseFlomoUrl(options.url) || FLOMO_URL;
    const actionIcons = joinIcons([
        iconButton("home", "#iconFlomoWebHome", i18n.home),
        iconButton("refresh", "#iconRefresh", i18n.refresh),
        iconButton("back", "#iconUndo", i18n.goBack),
        iconButton("forward", "#iconRedo", i18n.goForward),
        iconButton("devtools", "#iconFlomoWebDevtools", i18n.devTools),
        ...(minBtn ? [minBtn] : []),
    ]);

    root.innerHTML = `<div class="fn__flex-1 fn__flex-column flomo-web${tabClass}"${immersiveAttr}>
    <div class="block__icons">
        <div class="block__logo fn__flex-1">
            <svg class="block__logoicon"><use xlink:href="#iconFlomoWeb"></use></svg>${i18n.dockTitle}
        </div>
        ${actionIcons}
    </div>
    <div class="fn__flex-1 flomo-web__stage">
        <webview class="flomo-web__webview" src="${escapeAttr(startSrc)}" partition="${WEBVIEW_PARTITION}"></webview>
        <div class="flomo-web__cover fn__none"></div>
    </div>
</div>`;

    webview = root.querySelector("webview") as WebviewEl | null;
    cover = root.querySelector(".flomo-web__cover");
    bindHeader(root);
    bindWebview();
    bindCover();

    function bindHeader(host: HTMLElement) {
        const icons = host.querySelector(".block__icons");
        if (!icons) {
            return;
        }
        const onClick = (event: Event) => {
            const btn = (event.target as HTMLElement).closest("[data-type]") as HTMLElement | null;
            if (!btn || !webview) {
                return;
            }
            const type = btn.getAttribute("data-type");
            if (type === "home") {
                webview.src = FLOMO_URL;
            } else if (type === "refresh") {
                webview.reload();
            } else if (type === "back") {
                if (webview.canGoBack()) {
                    webview.goBack();
                }
            } else if (type === "forward") {
                if (webview.canGoForward()) {
                    webview.goForward();
                }
            } else if (type === "devtools") {
                if (webview.isDevToolsOpened()) {
                    webview.closeDevTools();
                } else {
                    webview.openDevTools();
                }
            }
        };
        icons.addEventListener("click", onClick);
        cleanups.push(() => icons.removeEventListener("click", onClick));
    }

    function bindWebview() {
        const view = webview;
        if (!view) {
            return;
        }
        const onReady = () => {
            view.executeJavaScript(getFlomoInjectScript()).catch((e) => {
                console.error(`${plugin.displayName}: inject flomo script failed`, e);
            });
        };
        const onPageTitle = (event: Event) => {
            const title = (event as Event & {title?: string;}).title;
            if (title) {
                options.onTitle?.(title);
            }
        };
        const onNavigate = (event: Event) => {
            const href = (event as Event & {url?: string;}).url || view.getURL?.();
            const abs = parseFlomoUrl(href || "");
            if (abs) {
                options.onUrl?.(abs);
            }
        };
        view.addEventListener("dom-ready", onReady as EventListener);
        if (options.onUrl) {
            view.addEventListener("did-navigate", onNavigate as EventListener);
            view.addEventListener("did-navigate-in-page", onNavigate as EventListener);
            cleanups.push(() => {
                view.removeEventListener("did-navigate", onNavigate as EventListener);
                view.removeEventListener("did-navigate-in-page", onNavigate as EventListener);
            });
        }
        if (options.onTitle) {
            view.addEventListener("page-title-updated", onPageTitle as EventListener);
            cleanups.push(() => view.removeEventListener("page-title-updated", onPageTitle as EventListener));
        }
        cleanups.push(() => view.removeEventListener("dom-ready", onReady as EventListener));
    }

    function bindCover() {
        const showCover = () => cover?.classList.remove("fn__none");
        const hideCover = () => cover?.classList.add("fn__none");

        const onDragStart = (event: DragEvent) => {
            const el = event.target as HTMLElement | null;
            if (!el) {
                return;
            }
            if (
                el.getAttribute("data-type") === "tab-header" ||
                el.parentElement?.getAttribute("data-type") === "tab-header"
            ) {
                showCover();
            }
        };
        const onResizeStart = (event: MouseEvent) => {
            if ((event.target as HTMLElement).classList.contains("layout__resize")) {
                showCover();
            }
        };
        const onResizeStop = (event: MouseEvent) => {
            if ((event.target as HTMLElement).classList.contains("layout__resize")) {
                hideCover();
            }
        };

        document.addEventListener("dragstart", onDragStart, true);
        document.addEventListener("dragend", hideCover, true);
        document.addEventListener("mousedown", onResizeStart, true);
        document.addEventListener("mouseup", onResizeStop, true);
        cleanups.push(() => {
            document.removeEventListener("dragstart", onDragStart, true);
            document.removeEventListener("dragend", hideCover, true);
            document.removeEventListener("mousedown", onResizeStart, true);
            document.removeEventListener("mouseup", onResizeStop, true);
        });
    }

    return () => {
        cleanups.forEach((fn) => fn());
        cleanups.length = 0;
        webview = null;
        cover = null;
    };
}
