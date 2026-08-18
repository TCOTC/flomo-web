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
    stop?: () => void;
    goBack: () => void;
    goForward: () => void;
    canGoBack: () => boolean;
    canGoForward: () => boolean;
    getURL: () => string;
    getWebContentsId: () => number;
    openDevTools: () => void;
    closeDevTools: () => void;
    isDevToolsOpened: () => boolean;
    executeJavaScript: (code: string) => Promise<unknown>;
}

/** AbortController 挂在 window 上，思源 eval 换代后新模块才能 abort 旧的 document 监听；模块级变量过不了换代 */
type CoverWindow = Window & {__flomoWebCoverAbort?: AbortController;};

type GuestWebContents = {
    setWindowOpenHandler?: (handler: (details: {url: string;}) => {action: "deny" | "allow";}) => void;
};

type ElectronRemote = {
    webContents?: {
        fromId?: (id: number) => GuestWebContents | undefined;
    };
};

function guestWebContentsOf(view: WebviewEl): GuestWebContents | undefined {
    try {
        const remote = (window as any).require?.("@electron/remote") as ElectronRemote | undefined;
        return remote?.webContents?.fromId?.(view.getWebContentsId());
    } catch {
        return undefined;
    }
}

function denyWindowOpen(): {action: "deny";} {
    return {action: "deny"};
}

const panelUnmounts = new WeakMap<Element, () => void>();

/** 先拆掉同一外壳上一次挂载，再记下新的卸载函数 */
export function setPanelUnmount(root: Element, unmount: () => void) {
    panelUnmounts.get(root)?.();
    panelUnmounts.set(root, unmount);
}

export function runPanelUnmount(root: Element) {
    panelUnmounts.get(root)?.();
    panelUnmounts.delete(root);
}

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

function eventString(event: Event, key: "title" | "url"): string {
    const value = (event as unknown as Record<string, unknown>)[key];
    return typeof value === "string" ? value : "";
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
    try {
        // 换成无闭包的 deny，避免 handler 继续抓住 view
        guestWebContentsOf(view)?.setWindowOpenHandler?.(denyWindowOpen);
    } catch (e) {
        console.error("flomo-web: reset window-open handler failed", e);
    }
    try {
        view.stop?.();
    } catch (e) {
        console.error("flomo-web: stop webview failed", e);
    }
    try {
        // 先离开业务页再摘节点，否则 persist 分区上的 guest 有时不退
        view.src = "about:blank";
    } catch (e) {
        console.error("flomo-web: blank webview failed", e);
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

function eventElement(target: EventTarget | null): Element | null {
    if (target instanceof Element) {
        return target;
    }
    return (target as Node | null)?.parentElement ?? null;
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
    let resizing = false;

    const onDragStart = (event: DragEvent) => {
        // 拖选中文本时 target 经常是文本节点，没有 getAttribute
        const el = eventElement(event.target);
        // 思源页签头是 li[data-type="tab-header"]（Tab.ts createTabHeaderElement），内部还有 svg / 标题 / 关闭按钮；Wnd.ts 用 closest
        if (el?.closest('[data-type="tab-header"]')) {
            showAllCovers();
        }
    };
    const isResizeHandle = (target: EventTarget | null) => {
        const el = eventElement(target);
        // 分栏条是 layout__resize，停靠栏内部再分栏是 layout__dockresize（dock/index.ts）
        return !!el?.closest(".layout__resize, .layout__dockresize");
    };
    const onResizeStart = (event: MouseEvent) => {
        if (event.button !== 0 || !isResizeHandle(event.target)) {
            return;
        }
        resizing = true;
        showAllCovers();
    };
    const onResizeStop = () => {
        if (!resizing) {
            return;
        }
        resizing = false;
        hideAllCovers();
    };

    // 捕获阶段尽早盖上，避免指针先落到 webview 上
    document.addEventListener("dragstart", onDragStart, {capture: true, signal});
    document.addEventListener("dragend", hideAllCovers, {capture: true, signal});
    document.addEventListener("mousedown", onResizeStart, {capture: true, signal});
    // 思源在 mousedown 后改绑 document.onmouseup，且会给 body 加上 fn__pointer-none，mouseup 不会落回手柄
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

const HEADER_ACTIONS: Record<string, (view: WebviewEl) => void> = {
    home: (view) => {
        view.src = FLOMO_URL;
    },
    refresh: (view) => {
        view.reload();
    },
    back: (view) => {
        if (view.canGoBack()) {
            view.goBack();
        }
    },
    forward: (view) => {
        if (view.canGoForward()) {
            view.goForward();
        }
    },
    devtools: (view) => {
        if (view.isDevToolsOpened()) {
            view.closeDevTools();
        } else {
            view.openDevTools();
        }
    },
};

const WINDOW_OPEN_SHIM = "window.open=function(url){if(url)location.href=url;return window;}";

function bindGuestWindowOpen(view: WebviewEl): boolean {
    try {
        const wc = guestWebContentsOf(view);
        if (!wc?.setWindowOpenHandler) {
            return false;
        }
        wc.setWindowOpenHandler((details) => {
            if (details.url) {
                view.src = details.url;
            }
            return denyWindowOpen();
        });
        return true;
    } catch {
        return false;
    }
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

    const actionIcons = [
        joinIcons([
            iconButton("home", "#iconFlomoWebHome", i18n.home),
            iconButton("refresh", "#iconRefresh", i18n.refresh),
            iconButton("back", "#iconUndo", i18n.goBack),
            iconButton("forward", "#iconRedo", i18n.goForward),
        ]),
        iconSpace("flomo-web__devtools-gap"),
        iconButton("devtools", "#iconFlomoWebDevtools", i18n.devTools),
    ];
    if (showMin) {
        actionIcons.push(iconSpace(), iconButton("min", "#iconMin", `${i18n.min} ${adaptHotkey("⌘W")}`));
    }

    const startSrc = parseFlomoUrl(options.url) || FLOMO_URL;
    root.innerHTML = `<div class="fn__flex-1 fn__flex-column flomo-web${tabClass}">
    <div class="block__icons">
        <div class="block__logo fn__flex-1">
            <svg class="block__logoicon"><use xlink:href="#iconFlomoWeb"></use></svg>${i18n.dockTitle}
        </div>
        ${actionIcons.join("")}
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
            const target = event.target;
            if (!(target instanceof Element) || !webview) {
                return;
            }
            // 思源停靠栏用 hasClosestByAttribute(..., "min") 处理最小化；选择器收窄，避免点 logo 时命中布局节点
            const btn = target.closest(".block__icon[data-type]");
            if (!btn || !icons.contains(btn)) {
                return;
            }
            const type = btn.getAttribute("data-type") || "";
            HEADER_ACTIONS[type]?.(webview);
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
            if (!bindGuestWindowOpen(view)) {
                view.executeJavaScript(WINDOW_OPEN_SHIM).catch((e) => {
                    console.error(`${plugin.displayName}: bind window.open failed`, e);
                });
            }
            view.executeJavaScript(getFlomoInjectScript()).catch((e) => {
                console.error(`${plugin.displayName}: inject flomo script failed`, e);
            });
        };
        const onPageTitle = (event: Event) => {
            const title = eventString(event, "title");
            if (title) {
                options.onTitle?.(title);
            }
        };
        const onNavigate = (event: Event) => {
            const href = eventString(event, "url") || view.getURL?.() || "";
            const abs = parseFlomoUrl(href);
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
