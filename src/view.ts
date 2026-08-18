import {adaptHotkey} from "siyuan";
import type {Plugin} from "siyuan";
import {
    registerConfigPanel,
    unregisterConfigPanel,
} from "./config";
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

type CoverWindow = Window & {__flomoWebCoverAbort?: AbortController;};

let coverUsers = 0;

/** 解析 flomo 网页链接，非 flomo 域名返回空字符串 */
export function parseFlomoUrl(raw: string): string {
    const href = raw.replace(/&amp;/g, "&").trim();
    try {
        const url = new URL(href);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
            return "";
        }
        const host = url.hostname.toLowerCase();
        if (host !== "flomoapp.com" && !host.endsWith(".flomoapp.com")) {
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
    return icons.join(iconSpace());
}

function iconSpace(extraClass = ""): string {
    const cls = extraClass ? `fn__space ${extraClass}` : "fn__space";
    return `<span class="${cls}"></span>`;
}

/** 关掉开发者工具并移除 webview，避免访客进程在外壳清空后仍活着 */
export function teardownWebview(el: Element) {
    const view = el as WebviewEl;
    try {
        if (view.isDevToolsOpened?.()) {
            view.closeDevTools();
        }
    } catch (e) {
        console.error("flomo-web: close DevTools failed", e);
    }
    view.remove();
}

function abortCoverListeners() {
    const w = window as CoverWindow;
    w.__flomoWebCoverAbort?.abort();
    w.__flomoWebCoverAbort = undefined;
}

function showAllCovers() {
    document.querySelectorAll(".flomo-web__cover").forEach((el) => {
        el.classList.remove("fn__none");
    });
}

function hideAllCovers() {
    document.querySelectorAll(".flomo-web__cover").forEach((el) => {
        el.classList.add("fn__none");
    });
}

/**
 * Electron 的 webview 是独立原生层，会挡住宿主的鼠标事件。
 * 拖页签或拖分栏经过它时，思源收不到 drop，所以临时盖一层遮罩把事件拦回来。
 * 页签头和分栏条都在本面板之外，只能在 document 上捕获。
 */
function bindCoverListeners() {
    abortCoverListeners();
    const ac = new AbortController();
    (window as CoverWindow).__flomoWebCoverAbort = ac;
    const signal = ac.signal;

    const onDragStart = (event: DragEvent) => {
        // 拖选中文本时 target 经常是文本节点，没有 getAttribute
        const raw = event.target;
        const el = raw instanceof Element ? raw : (raw as Node | null)?.parentElement;
        // 思源页签是带 data-type="tab-header" 的 li，点中的可能是内部文字或图标
        if (
            el?.getAttribute("data-type") === "tab-header" ||
            el?.parentElement?.getAttribute("data-type") === "tab-header"
        ) {
            showAllCovers();
        }
    };
    const onResizeStart = (event: MouseEvent) => {
        const el = event.target;
        if (el instanceof Element && el.classList.contains("layout__resize")) {
            showAllCovers();
        }
    };
    const onResizeStop = (event: MouseEvent) => {
        const el = event.target;
        if (el instanceof Element && el.classList.contains("layout__resize")) {
            hideAllCovers();
        }
    };

    // 捕获阶段尽早盖上，避免指针先落到 webview 上
    document.addEventListener("dragstart", onDragStart, {capture: true, signal});
    document.addEventListener("dragend", hideAllCovers, {capture: true, signal});
    document.addEventListener("mousedown", onResizeStart, {capture: true, signal});
    document.addEventListener("mouseup", onResizeStop, {capture: true, signal});
}

function acquireCover() {
    coverUsers++;
    if (coverUsers === 1) {
        bindCoverListeners();
    }
}

function releaseCover() {
    if (coverUsers <= 0) {
        return;
    }
    coverUsers--;
    if (coverUsers === 0) {
        abortCoverListeners();
    }
}

/** 插件卸载时强制拆掉遮罩监听，避免 eval 换代后 refcount 对不上 */
export function disposeFlomoCovers() {
    coverUsers = 0;
    abortCoverListeners();
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
    const tabClass = options.isTab ? " flomo-web--tab" : "";

    root.querySelectorAll("webview.flomo-web__webview").forEach((el) => {
        teardownWebview(el);
    });

    const minBtn = showMin ? iconButton("min", "#iconMin", `${i18n.min} ${adaptHotkey("⌘W")}`) : "";

    const startSrc = parseFlomoUrl(options.url) || FLOMO_URL;
    const actionIcons = [
        joinIcons([
            iconButton("home", "#iconFlomoWebHome", i18n.home),
            iconButton("refresh", "#iconRefresh", i18n.refresh),
            iconButton("back", "#iconUndo", i18n.goBack),
            iconButton("forward", "#iconRedo", i18n.goForward),
        ]),
        iconSpace("flomo-web__devtools-gap"),
        iconButton("devtools", "#iconFlomoWebDevtools", i18n.devTools),
        minBtn ? iconSpace() + minBtn : "",
    ].join("");

    root.innerHTML = `<div class="fn__flex-1 fn__flex-column flomo-web${tabClass}">
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
    const panel = root.querySelector(".flomo-web") as HTMLElement | null;
    if (panel) {
        registerConfigPanel(panel);
        cleanups.push(() => unregisterConfigPanel(panel));
    }
    bindHeader(root);
    bindWebview();
    acquireCover();
    cleanups.push(releaseCover);

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

    return () => {
        cleanups.forEach((fn) => fn());
        cleanups.length = 0;
        if (webview) {
            teardownWebview(webview);
            webview = null;
        }
    };
}
