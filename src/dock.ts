import {
    adaptHotkey,
    getFrontend,
    type Plugin,
} from "siyuan";
import type zhCN from "./i18n/zh-CN.json";
import {getFlomoInjectScript} from "./inject";

export const FLOMO_URL = "https://v.flomoapp.com";
export const DOCK_TYPE = "flomo";
export const WEBVIEW_PARTITION = "persist:flomo-web";

type FlomoPlugin = Plugin & {i18n: typeof zhCN;};

interface WebviewEl extends HTMLElement {
    src: string;
    reload: () => void;
    goBack: () => void;
    goForward: () => void;
    canGoBack: () => boolean;
    canGoForward: () => boolean;
    openDevTools: () => void;
    closeDevTools: () => void;
    isDevToolsOpened: () => boolean;
    executeJavaScript: (code: string) => Promise<unknown>;
}

function isElectronDesktop(): boolean {
    const frontEnd = getFrontend();
    return frontEnd === "desktop" || frontEnd === "desktop-window";
}

function iconButton(type: string, href: string, label: string): string {
    return `<span data-type="${type}" class="block__icon ariaLabel" data-position="north" aria-label="${label}"><svg><use xlink:href="${href}"></use></svg></span>`;
}

export function registerFlomoDock(plugin: FlomoPlugin) {
    const i18n = plugin.i18n;
    let webview: WebviewEl | null = null;
    let cover: HTMLElement | null = null;
    const cleanups: Array<() => void> = [];

    plugin.addDock({
        config: {
            position: "RightTop",
            size: {width: 420, height: 0},
            icon: "iconFlomoWeb",
            title: i18n.dockTitle,
        },
        data: {},
        type: DOCK_TYPE,
        init() {
            const minLabel = `${i18n.min} ${adaptHotkey("⌘W")}`;
            const root = this.element;
            if (!isElectronDesktop()) {
                root.innerHTML = `<div class="fn__flex-1 fn__flex-column flomo-web">
    <div class="block__icons">
        <div class="block__logo">
            <svg class="block__logoicon"><use xlink:href="#iconFlomoWeb"></use></svg>${i18n.dockTitle}
        </div>
        <span class="fn__flex-1 fn__space"></span>
        <span data-type="min" class="block__icon ariaLabel" data-position="north" aria-label="${minLabel}"><svg><use xlink:href="#iconMin"></use></svg></span>
    </div>
    <div class="b3-typography flomo-web__fallback">${i18n.desktopOnly}</div>
</div>`;
                return;
            }

            root.innerHTML = `<div class="fn__flex-1 fn__flex-column flomo-web">
    <div class="block__icons">
        <div class="block__logo">
            <svg class="block__logoicon"><use xlink:href="#iconFlomoWeb"></use></svg>${i18n.dockTitle}
        </div>
        <span class="fn__flex-1 fn__space"></span>
        ${iconButton("home", "#iconFlomoWebHome", i18n.home)}
        ${iconButton("refresh", "#iconRefresh", i18n.refresh)}
        ${iconButton("back", "#iconUndo", i18n.goBack)}
        ${iconButton("forward", "#iconRedo", i18n.goForward)}
        ${iconButton("devtools", "#iconFlomoWebDevtools", i18n.devTools)}
        <span data-type="min" class="block__icon ariaLabel" data-position="north" aria-label="${minLabel}"><svg><use xlink:href="#iconMin"></use></svg></span>
    </div>
    <div class="fn__flex-1 flomo-web__stage">
        <webview class="flomo-web__webview" src="${FLOMO_URL}" partition="${WEBVIEW_PARTITION}"></webview>
        <div class="flomo-web__cover fn__none"></div>
    </div>
</div>`;

            webview = root.querySelector("webview") as WebviewEl | null;
            cover = root.querySelector(".flomo-web__cover");
            bindHeader(root);
            bindWebview();
            bindCover();
        },
        destroy() {
            cleanups.forEach((fn) => fn());
            cleanups.length = 0;
            webview = null;
            cover = null;
        },
    });

    function bindHeader(root: HTMLElement | Element) {
        const icons = root.querySelector(".block__icons");
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
        view.addEventListener("dom-ready", onReady as EventListener);
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
}
