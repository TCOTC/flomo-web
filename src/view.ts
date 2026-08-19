import {adaptHotkey} from "siyuan";
import type {Plugin} from "siyuan";
import {
    ATTR_DEVTOOLS,
    getConfig,
    registerConfigPanel,
    unregisterConfigPanel,
} from "./config";
import type zhCN from "./i18n/zh-CN.json";
import {getFlomoInjectScript, GUEST_OPEN_PREFIX} from "./inject";

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
    on?: (event: string, listener: (...args: unknown[]) => void) => void;
    removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
    debugger?: {
        attach: (protocol?: string) => void;
        detach: () => void;
        isAttached: () => boolean;
        sendCommand: (method: string, params?: object) => Promise<unknown>;
    };
};

type ElectronRemote = {
    webContents?: {
        fromId?: (id: number) => GuestWebContents | undefined;
    };
    require?: (modulePath: string) => unknown;
};

export function findFlomoWebviews(): WebviewEl[] {
    return Array.from(document.querySelectorAll("webview.flomo-web__webview")) as WebviewEl[];
}

function guestWebContentsOf(view: WebviewEl): GuestWebContents | undefined {
    try {
        const remote = (window as any).require?.("@electron/remote") as ElectronRemote | undefined;
        return remote?.webContents?.fromId?.(view.getWebContentsId());
    } catch {
        return undefined;
    }
}

/** 节点已摘掉或尚未 dom-ready 时 getWebContentsId 会抛，Electron 会拒绝其余 webview 方法 */
export function webviewGuestReady(view: WebviewEl): boolean {
    try {
        view.getWebContentsId();
        return true;
    } catch {
        return false;
    }
}

function denyWindowOpen(): {action: "deny";} {
    return {action: "deny"};
}

function isHttpUrl(raw: string): boolean {
    try {
        const url = new URL(raw);
        return url.protocol === "http:" || url.protocol === "https:";
    } catch {
        return false;
    }
}

/** 非 flomo 链接交给思源的 window.open（不要自己 shell.openExternal） */
function openBySiyuan(raw: string) {
    if (!isHttpUrl(raw)) {
        return;
    }
    window.open(raw);
}

/** 思源 html[data-theme-mode]，不跟操作系统 */
function siyuanIsDark(): boolean {
    const mode = document.documentElement.getAttribute("data-theme-mode");
    if (mode === "dark") {
        return true;
    }
    if (mode === "light") {
        return false;
    }
    return (window as any).siyuan?.config?.appearance?.mode === 1;
}

function applyGuestColorScheme(view: WebviewEl) {
    if (!webviewGuestReady(view)) {
        return;
    }
    const dark = siyuanIsDark();
    const scheme = dark ? "dark" : "light";
    try {
        const dbg = guestWebContentsOf(view)?.debugger;
        if (dbg) {
            if (!dbg.isAttached()) {
                dbg.attach("1.3");
            }
            void dbg.sendCommand("Emulation.setEmulatedMedia", {
                features: [{name: "prefers-color-scheme", value: scheme}],
            });
        }
    } catch (e) {
        console.error("flomo-web: emulate color-scheme failed", e);
    }
    view.executeJavaScript(
        `document.documentElement.style.colorScheme=${JSON.stringify(scheme)}`,
    ).catch(() => {
        // 页面可能还没建好 documentElement
    });
}

let themeUsers = 0;
let themeObserver: MutationObserver | undefined;

function acquireThemeWatch() {
    themeUsers++;
    if (themeUsers !== 1) {
        return;
    }
    themeObserver = new MutationObserver(() => {
        findFlomoWebviews().forEach(applyGuestColorScheme);
    });
    themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme-mode"],
    });
}

function releaseThemeWatch() {
    if (themeUsers <= 0) {
        return;
    }
    themeUsers--;
    if (themeUsers === 0) {
        themeObserver?.disconnect();
        themeObserver = undefined;
    }
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

function eventString(event: Event, key: "title" | "url" | "message"): string {
    const value = (event as unknown as Record<string, unknown>)[key];
    return typeof value === "string" ? value : "";
}

/** 关掉开发者工具并移除 webview，避免访客进程在外壳清空后仍活着 */
export function teardownWebview(el: Element) {
    const view = el as WebviewEl;
    // 手动关页签时思源会先拆 DOM 再 destroy，此时 guest 方法必然失败，跳过即可
    if (webviewGuestReady(view)) {
        try {
            if (view.isDevToolsOpened()) {
                view.closeDevTools();
            }
            // 换成无闭包的 deny，避免 handler 继续抓住 view
            guestWebContentsOf(view)?.setWindowOpenHandler?.(denyWindowOpen);
        } catch (e) {
            console.error("flomo-web: teardown webview failed", e);
        }
    }
    // 不要再 load about:blank：src 是异步 IPC，立刻摘节点会变成 ERR_FAILED
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
    themeUsers = 0;
    themeObserver?.disconnect();
    themeObserver = undefined;
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
        try {
            mainDevtoolsHook?.allowGuestDevTools?.();
        } catch {
            // 挂钩尚未加载时仍打开网页开发者工具
        }
        if (view.isDevToolsOpened()) {
            view.closeDevTools();
        } else {
            view.openDevTools();
        }
    },
};

function routeGuestUrl(view: WebviewEl, raw: string) {
    const flomo = parseFlomoUrl(raw);
    if (flomo) {
        view.src = flomo;
        return;
    }
    if (isHttpUrl(raw)) {
        openBySiyuan(raw);
    }
}

/**
 * 用 HTML 一次写好 partition 与 webpreferences。
 * 若用 createElement 先写 src 再入树，guest 可能已按默认偏好创建，关掉开发者工具不会生效。
 */
function webviewMarkup(src?: string): string {
    const srcAttr = src ? ` src="${escapeAttr(src)}"` : "";
    const tools = getConfig().showDevToolsButton;
    const toolsAttr = tools
        ? ` ${ATTR_DEVTOOLS}="1"`
        : ` ${ATTR_DEVTOOLS}="0" webpreferences="devTools=no"`;
    return `<webview class="flomo-web__webview"${srcAttr} partition="${WEBVIEW_PARTITION}"${toolsAttr}></webview>`;
}

type MainDevtoolsHook = {
    hook: (id: number) => void;
    unhook: (id: number) => void;
    unhookAll: () => void;
    allowGuestDevTools?: () => void;
};

/** undefined 尚未尝试；null 加载失败 */
let mainDevtoolsHook: MainDevtoolsHook | null | undefined;

function loadMainDevtoolsHook(pluginName: string): MainDevtoolsHook | null {
    if (mainDevtoolsHook !== undefined) {
        return mainDevtoolsHook;
    }
    try {
        const req = (window as any).require as ((id: string) => any) | undefined;
        const remote = req?.("@electron/remote") as ElectronRemote | undefined;
        const nodePath = req?.("path") as {join: (...parts: string[]) => string;} | undefined;
        const dataDir = (window as any).siyuan?.config?.system?.dataDir as string | undefined;
        if (!remote?.require || !nodePath?.join || !dataDir || !pluginName) {
            mainDevtoolsHook = null;
            return null;
        }
        const file = nodePath.join(dataDir, "plugins", pluginName, "devtools-hook.cjs");
        mainDevtoolsHook = remote.require(file) as MainDevtoolsHook;
        return mainDevtoolsHook;
    } catch (e) {
        console.error("flomo-web: load main devtools hook failed", e);
        mainDevtoolsHook = null;
        return null;
    }
}

function guestContentsId(view: WebviewEl): number {
    if (!webviewGuestReady(view)) {
        return 0;
    }
    try {
        return view.getWebContentsId();
    } catch {
        return 0;
    }
}

/** 插件卸载时拆掉主进程 before-input-event；模块本身会留在 remote.require 缓存里 */
export function disposeGuestDevtoolsHook() {
    try {
        mainDevtoolsHook?.unhookAll();
    } catch (e) {
        console.error("flomo-web: unhook guest devtools failed", e);
    }
}

/**
 * Chromium 会把开发者工具快捷键交给 webview，宿主收不到。
 * 必须在主进程 preventDefault，再打开思源窗口的开发者工具。
 */
function bindGuestDevToolsKeys(view: WebviewEl, pluginName: string): () => void {
    const hook = loadMainDevtoolsHook(pluginName);
    const id = guestContentsId(view);
    if (hook && id) {
        try {
            hook.hook(id);
        } catch (e) {
            console.error("flomo-web: hook guest devtools failed", e);
        }
    }
    return () => {
        // 关页签时思源会先拆 DOM，getWebContentsId 会失败，必须用 hook 时记下的 id
        if (hook && id) {
            try {
                hook.unhook(id);
            } catch {
                return;
            }
        }
    };
}

function bindGuestWindowOpen(view: WebviewEl): boolean {
    try {
        const wc = guestWebContentsOf(view);
        if (!wc?.setWindowOpenHandler) {
            return false;
        }
        wc.setWindowOpenHandler((details) => {
            if (details.url) {
                routeGuestUrl(view, details.url);
            }
            return denyWindowOpen();
        });
        return true;
    } catch {
        return false;
    }
}

function bindGuestConsoleOpen(view: WebviewEl): () => void {
    const onConsole = (event: Event) => {
        const msg = eventString(event, "message");
        if (msg.indexOf(GUEST_OPEN_PREFIX) !== 0) {
            return;
        }
        openBySiyuan(msg.slice(GUEST_OPEN_PREFIX.length));
    };
    view.addEventListener("console-message", onConsole as EventListener);
    return () => view.removeEventListener("console-message", onConsole as EventListener);
}

function bindGuestNavigateGuard(view: WebviewEl): () => void {
    const wc = guestWebContentsOf(view);
    if (!wc?.on) {
        return () => undefined;
    }
    const onNavigate = (...args: unknown[]) => {
        const first = args[0] as {preventDefault?: () => void; url?: string;} | string | undefined;
        const second = args[1];
        let href = "";
        let prevent: (() => void) | undefined;
        if (typeof first === "string") {
            href = first;
        } else if (first && typeof first === "object") {
            prevent = first.preventDefault?.bind(first);
            href = typeof first.url === "string" ? first.url : "";
        }
        if (!href && typeof second === "string") {
            href = second;
        }
        if (!href || parseFlomoUrl(href)) {
            return;
        }
        if (!isHttpUrl(href)) {
            return;
        }
        prevent?.();
        openBySiyuan(href);
    };
    wc.on("will-navigate", onNavigate);
    wc.on("will-redirect", onNavigate);
    return () => {
        wc.removeListener?.("will-navigate", onNavigate);
        wc.removeListener?.("will-redirect", onNavigate);
    };
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
    const viewCleanups: Array<() => void> = [];
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
        ${webviewMarkup(startSrc)}
        <div class="flomo-web__cover fn__none"></div>
    </div>
</div>`;

    webview = root.querySelector("webview") as WebviewEl | null;
    const panel = root.querySelector(".flomo-web") as HTMLElement | null;
    if (panel) {
        registerConfigPanel(panel);
        panel.addEventListener("flomo-web-devtools-pref", replaceGuest);
        cleanups.push(() => {
            panel.removeEventListener("flomo-web-devtools-pref", replaceGuest);
            unregisterConfigPanel(panel);
        });
    }
    bindHeader(root);
    bindWebview();
    acquireCover();
    acquireThemeWatch();
    cleanups.push(releaseCover);
    cleanups.push(releaseThemeWatch);

    function guestSrc(): string {
        if (webview && webviewGuestReady(webview)) {
            try {
                const href = webview.getURL();
                return parseFlomoUrl(href) || href || startSrc;
            } catch {
                return webview.src || startSrc;
            }
        }
        return webview?.src || startSrc;
    }

    function unbindWebview() {
        viewCleanups.forEach((fn) => fn());
        viewCleanups.length = 0;
    }

    function replaceGuest() {
        const stage = root.querySelector(".flomo-web__stage");
        if (!stage) {
            return;
        }
        const src = guestSrc();
        unbindWebview();
        if (webview) {
            teardownWebview(webview);
            webview = null;
        }
        const cover = stage.querySelector(".flomo-web__cover");
        if (cover) {
            cover.insertAdjacentHTML("beforebegin", webviewMarkup());
            webview = cover.previousElementSibling as WebviewEl;
        } else {
            stage.insertAdjacentHTML("beforeend", webviewMarkup());
            webview = stage.querySelector("webview.flomo-web__webview") as WebviewEl;
        }
        // 先绑事件再设 src：分区已热时入树可能马上发出 did-attach，设完再听会漏掉快捷键
        bindWebview();
        if (webview) {
            webview.src = src;
        }
    }

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
        let navigated = false;
        const onReady = () => {
            if (!webviewGuestReady(view)) {
                return;
            }
            bindGuestWindowOpen(view);
            if (!navigated) {
                if (!guestWebContentsOf(view)?.on) {
                    return;
                }
                navigated = true;
                viewCleanups.push(bindGuestNavigateGuard(view));
                viewCleanups.push(bindGuestConsoleOpen(view));
                viewCleanups.push(bindGuestDevToolsKeys(view, plugin.name));
            }
            applyGuestColorScheme(view);
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
        view.addEventListener("did-attach", onReady as EventListener);
        view.addEventListener("dom-ready", onReady as EventListener);
        if (options.onUrl) {
            view.addEventListener("did-navigate", onNavigate as EventListener);
            view.addEventListener("did-navigate-in-page", onNavigate as EventListener);
            viewCleanups.push(() => {
                view.removeEventListener("did-navigate", onNavigate as EventListener);
                view.removeEventListener("did-navigate-in-page", onNavigate as EventListener);
            });
        }
        if (options.onTitle) {
            view.addEventListener("page-title-updated", onPageTitle as EventListener);
            viewCleanups.push(() => view.removeEventListener("page-title-updated", onPageTitle as EventListener));
        }
        viewCleanups.push(() => {
            view.removeEventListener("did-attach", onReady as EventListener);
            view.removeEventListener("dom-ready", onReady as EventListener);
        });
        if (webviewGuestReady(view)) {
            onReady();
        }
    }

    return () => {
        unbindWebview();
        cleanups.forEach((fn) => fn());
        cleanups.length = 0;
        if (webview) {
            teardownWebview(webview);
            webview = null;
        }
    };
}
