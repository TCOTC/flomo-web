import type {IEventBusMap} from "siyuan";
import {localizePastedAssets} from "./assets";
import type {FlomoPlugin} from "./view";

/** text/plain 里的零宽标记；Lute 若丢掉 HTML 上的 data-flomo-web，仍能认出是本插件拖出的卡片 */
const TEXT_MARK = "\u200cflomo-web\u200c";

/** petal 把 resolve 写成了 construct signature（`new ...`），运行时其实是 `new Promise` 的 resolve 回调 */
type PastePayload = {
    textHTML: string;
    textPlain: string;
    siyuanHTML?: string;
    files: IEventBusMap["paste"]["files"];
};

function isFlomoWebClipboard(textHTML: string, textPlain: string): boolean {
    return (textPlain && textPlain.indexOf(TEXT_MARK) >= 0) ||
        (textHTML && textHTML.indexOf("data-flomo-web") >= 0);
}

function stripMarks(textHTML: string, textPlain: string): {html: string; plain: string;} {
    return {
        html: textHTML.replace(/\sdata-flomo-web="1"/g, ""),
        plain: textPlain.split(TEXT_MARK).join("").replace(/^\n/, ""),
    };
}

function prepareBlockDOM(dom: string): string {
    const wrap = document.createElement("div");
    wrap.innerHTML = dom;
    wrap.querySelectorAll("[data-node-id]").forEach((el) => {
        el.setAttribute("data-node-id", window.Lute.NewNodeID());
    });
    // 根块带上选中类后，思源会按整块粘贴处理，不会把第一段并进光标所在块
    Array.from(wrap.children).forEach((el) => {
        el.classList.add("protyle-wysiwyg--select");
    });
    return wrap.innerHTML;
}

/** 拖入的 flomo 卡片用前端 Lute 转块，整卡作为独立块插入 */
export function bindFlomoPaste(plugin: FlomoPlugin): () => void {
    const onPaste = (event: CustomEvent<IEventBusMap["paste"]>) => {
        const {textHTML, textPlain, siyuanHTML, files, resolve, protyle} = event.detail;
        if (siyuanHTML || !isFlomoWebClipboard(textHTML, textPlain)) {
            return;
        }
        // EventBus.emit 可取消；preventDefault 后思源才会等插件 resolve，见 paste.ts
        event.preventDefault();
        const {html, plain} = stripMarks(textHTML, textPlain);
        const done = resolve as unknown as (value: PastePayload) => void;
        try {
            const lute = protyle.lute;
            if (!lute?.HTML2BlockDOM) {
                throw new Error("protyle.lute.HTML2BlockDOM is unavailable");
            }
            const dom = prepareBlockDOM(lute.HTML2BlockDOM(html));
            if (!dom) {
                throw new Error("HTML2BlockDOM returned empty");
            }
            const wrap = document.createElement("div");
            wrap.innerHTML = dom;
            const blockIds: string[] = [];
            Array.from(wrap.children).forEach((el) => {
                const id = el.getAttribute("data-node-id");
                if (id) {
                    blockIds.push(id);
                }
            });
            done({
                textHTML: html,
                textPlain: plain,
                siyuanHTML: wrap.innerHTML,
                files,
            });
            localizePastedAssets({plugin, protyle, blockIds, wrap});
        } catch (e) {
            console.error(`${plugin.displayName}: HTML2BlockDOM failed`, e);
            done({
                textHTML: html,
                textPlain: plain,
                files,
            });
        }
    };
    plugin.eventBus.on("paste", onPaste);
    return () => plugin.eventBus.off("paste", onPaste);
}
