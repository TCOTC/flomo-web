import type {IEventBusMap} from "siyuan";
import type {FlomoPlugin} from "./view";

const TEXT_MARK = "\u200cflomo-web\u200c";

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
        event.preventDefault();
        const {html, plain} = stripMarks(textHTML, textPlain);
        const done = resolve as unknown as (value: {
            textHTML: string;
            textPlain: string;
            siyuanHTML?: string;
            files: typeof files;
        }) => void;
        try {
            const lute = protyle.lute;
            if (!lute?.HTML2BlockDOM) {
                throw new Error("protyle.lute.HTML2BlockDOM is unavailable");
            }
            const dom = prepareBlockDOM(lute.HTML2BlockDOM(html));
            if (!dom) {
                throw new Error("HTML2BlockDOM returned empty");
            }
            done({
                textHTML: html,
                textPlain: plain,
                siyuanHTML: dom,
                files,
            });
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
