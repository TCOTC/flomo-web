import {
    DOCK_TYPE,
    FLOMO_URL,
    type FlomoPlugin,
    mountFlomoPanel,
    runPanelUnmount,
    setPanelUnmount,
} from "./view";

export function registerFlomoDock(plugin: FlomoPlugin) {
    plugin.addDock({
        config: {
            position: "RightTop",
            size: {width: 420, height: 0},
            icon: "iconFlomoWeb",
            title: plugin.i18n.dockTitle,
        },
        data: {},
        type: DOCK_TYPE,
        init() {
            const root = this.element as HTMLElement;
            setPanelUnmount(
                root,
                mountFlomoPanel({
                    root,
                    plugin,
                    url: FLOMO_URL,
                    showMin: true,
                }),
            );
        },
        destroy() {
            runPanelUnmount(this.element);
        },
    });
}
