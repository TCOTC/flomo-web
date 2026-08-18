import {
    openTab,
    type Custom,
} from "siyuan";
import {
    FLOMO_URL,
    type FlomoPlugin,
    mountFlomoPanel,
    parseFlomoUrl,
    runPanelUnmount,
    setPanelUnmount,
    TAB_TYPE,
} from "./view";

function unmountCustom(custom: Custom) {
    runPanelUnmount(custom.element);
}

/** 禁用 / 更新插件时拆掉页签内容，只留外壳。不能放在 update 里，同步也会调 update */
function emptyCustom(custom: Custom) {
    unmountCustom(custom);
    (custom.element as HTMLElement).innerHTML = "";
}

function mountCustom(custom: Custom, plugin: FlomoPlugin) {
    const url = custom.data?.url || FLOMO_URL;
    setPanelUnmount(
        custom.element,
        mountFlomoPanel({
            root: custom.element as HTMLElement,
            plugin,
            url,
            showMin: false,
            isTab: true,
            onTitle: (title) => {
                custom.tab?.updateTitle(title);
            },
            onUrl: (href) => {
                if (custom.data) {
                    custom.data.url = href;
                } else {
                    custom.data = {url: href};
                }
            },
        }),
    );
}

/**
 * 换上当前插件实例的钩子，否则更新后仍走旧闭包。
 * 把 update 置空：思源同步也会调 update，真正的重建放在 init / hydrate。
 */
function bindCustomHooks(custom: Custom) {
    custom.update = undefined;
    custom.destroy = function() {
        unmountCustom(this);
    };
}

function attachTab(custom: Custom, plugin: FlomoPlugin) {
    bindCustomHooks(custom);
    mountCustom(custom, plugin);
}

export function registerFlomoTab(plugin: FlomoPlugin) {
    plugin.addTab({
        type: TAB_TYPE,
        init(this: Custom) {
            attachTab(this, plugin);
        },
        destroy(this: Custom) {
            unmountCustom(this);
        },
    });
}

function eachFlomoTab(plugin: FlomoPlugin, fn: (custom: Custom) => void) {
    plugin.getOpenedTab()[TAB_TYPE]?.forEach(fn);
}

/**
 * 思源在禁用 / 更新时不会用新插件的 init 重建已有 Custom。
 * 新实例加载后把仍打开的空壳重新挂上。
 */
export function hydrateOpenFlomoTabs(plugin: FlomoPlugin) {
    eachFlomoTab(plugin, (custom) => attachTab(custom, plugin));
}

/** 禁用时思源不销毁自定义页签，只掏空内容，避免 webview 访客进程残留 */
export function emptyOpenFlomoTabs(plugin: FlomoPlugin) {
    eachFlomoTab(plugin, emptyCustom);
}

/** 用自定义页签打开 flomo 网页；默认新开，不复用已有页签 */
export function openFlomoTab(plugin: FlomoPlugin, url = FLOMO_URL, openNew = true) {
    const abs = parseFlomoUrl(url) || FLOMO_URL;
    openTab({
        app: plugin.app,
        custom: {
            icon: "iconFlomoWeb",
            title: plugin.i18n.dockTitle,
            data: {url: abs},
            id: plugin.name + TAB_TYPE,
        },
        openNewTab: openNew,
    });
}

function closestEditorLink(el: Element | null): HTMLElement | null {
    let current: Element | null = el;
    while (current && current !== document.body) {
        if (current.tagName === "A" && current.getAttribute("href")) {
            return current as HTMLElement;
        }
        const dataType = (current.getAttribute("data-type") || "").split(" ");
        if (dataType.indexOf("a") >= 0) {
            return current as HTMLElement;
        }
        if (current.classList.contains("av__celltext--url")) {
            return current as HTMLElement;
        }
        current = current.parentElement;
    }
    return null;
}

function linkHrefOf(el: HTMLElement): string {
    return el.getAttribute("data-href") || el.getAttribute("href") || el.getAttribute("data-url") || "";
}

/** 捕获阶段拦住 flomo 链接，避免思源随后 shell.openExternal */
export function bindFlomoLinkClicks(plugin: FlomoPlugin): () => void {
    const onCaptureClick = (event: MouseEvent) => {
        if (event.button !== 0 || event.defaultPrevented) {
            return;
        }
        const el = event.target instanceof Element
            ? event.target
            : (event.target as Node | null)?.parentElement;
        const inEditor = el?.closest(".protyle-wysiwyg, .protyle-preview, .b3-typography");
        if (!inEditor) {
            return;
        }
        const sel = window.getSelection();
        if (sel && sel.toString() !== "" && !event.shiftKey) {
            return;
        }
        const linkEl = closestEditorLink(el);
        if (!linkEl) {
            return;
        }
        const href = parseFlomoUrl(linkHrefOf(linkEl));
        if (!href) {
            return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        openFlomoTab(plugin, href, true);
    };
    document.addEventListener("click", onCaptureClick, true);
    return () => document.removeEventListener("click", onCaptureClick, true);
}
