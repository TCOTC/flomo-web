import {
    openTab,
    type Custom,
    type IEventBusMap,
} from "siyuan";
import {
    FLOMO_URL,
    type FlomoPlugin,
    mountFlomoPanelWhenReady,
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
        mountFlomoPanelWhenReady({
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

const EDITOR_LINK_ROOT = ".protyle-wysiwyg, .protyle-preview, .b3-typography";

/** 只拦编辑器左键；菜单 / 快捷键「使用默认程序打开」不带鼠标事件，交给系统默认程序 */
function isEditorOpenLinkEvent(origin?: MouseEvent | KeyboardEvent): boolean {
    if (!(origin instanceof MouseEvent) || origin.button !== 0) {
        return false;
    }
    const el = origin.target instanceof Element ?
        origin.target :
        (origin.target as Node | null)?.parentElement;
    return !!el?.closest(EDITOR_LINK_ROOT);
}

/** 通过 open-link 拦住编辑器里的 flomo 链接，避免内核随后 shell.openExternal */
export function bindFlomoOpenLink(plugin: FlomoPlugin): () => void {
    const onOpenLink = (event: CustomEvent<IEventBusMap["open-link"]>) => {
        if (!isEditorOpenLinkEvent(event.detail.event)) {
            return;
        }
        const href = parseFlomoUrl(event.detail.href);
        if (!href) {
            return;
        }
        event.preventDefault();
        openFlomoTab(plugin, href, true);
    };
    plugin.eventBus.on("open-link", onOpenLink);
    return () => plugin.eventBus.off("open-link", onOpenLink);
}
