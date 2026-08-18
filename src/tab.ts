import {
    openTab,
    type Custom,
} from "siyuan";
import {
    FLOMO_URL,
    type FlomoPlugin,
    mountFlomoPanel,
    parseFlomoUrl,
    TAB_TYPE,
} from "./view";

const unmounts = new WeakMap<Element, () => void>();

export function registerFlomoTab(plugin: FlomoPlugin) {
    plugin.addTab({
        type: TAB_TYPE,
        init(this: Custom) {
            const url = this.data?.url || FLOMO_URL;
            unmounts.set(
                this.element,
                mountFlomoPanel({
                    root: this.element as HTMLElement,
                    plugin,
                    url,
                    showMin: false,
                    isTab: true,
                    onTitle: (title) => {
                        this.tab?.updateTitle(title);
                    },
                    onUrl: (href) => {
                        if (this.data) {
                            this.data.url = href;
                        } else {
                            this.data = {url: href};
                        }
                    },
                }),
            );
        },
        destroy(this: Custom) {
            unmounts.get(this.element)?.();
            unmounts.delete(this.element);
        },
    });
}

/** 用自定义页签打开 flomo 网页；openNew 为 true 时始终新建页签 */
export function openFlomoTab(plugin: FlomoPlugin, url = FLOMO_URL, openNew = false) {
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

function closestEditorLink(el: EventTarget | null): HTMLElement | null {
    let node: Node | null = el as Node | null;
    if (node && node.nodeType === Node.TEXT_NODE) {
        node = node.parentElement;
    }
    let current = node as Element | null;
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
        const target = event.target as Node | null;
        const inEditor = (event.target as Element | null)?.closest?.(
            ".protyle-wysiwyg, .protyle-preview, .b3-typography",
        );
        if (!inEditor) {
            return;
        }
        const sel = window.getSelection();
        if (sel && sel.toString() !== "" && !event.shiftKey) {
            return;
        }
        const linkEl = closestEditorLink(target);
        if (!linkEl) {
            return;
        }
        const href = parseFlomoUrl(linkHrefOf(linkEl));
        if (!href) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        openFlomoTab(plugin, href, true);
    };
    document.addEventListener("click", onCaptureClick, true);
    return () => document.removeEventListener("click", onCaptureClick, true);
}
