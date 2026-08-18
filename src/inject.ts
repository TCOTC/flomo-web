/** 注入 flomo 页面：让卡片可拖拽，并把换行拆成独立段落。 */

export function getFlomoInjectScript(): string {
    // 转成字符串后丢进 webview 执行，flomoInjectMain 不能引用模块作用域
    return `(${flomoInjectMain.toString()})();`;
}

function flomoInjectMain() {
    const w = window as Window & {__flomoWebInjected?: boolean;};
    // dom-ready 可能再跑一遍注入脚本，用窗口标记避免重复绑定
    if (w.__flomoWebInjected) {
        return;
    }
    w.__flomoWebInjected = true;

    const MEMO_SELECTOR = ".memo";
    /** 只取正文，避免 .mainContent 里的相关卡片 / 页头工具栏 */
    const CONTENT_SELECTORS = [".richText", ".content"];

    function escapeHtml(text: string): string {
        return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    function escapeAttr(text: string): string {
        return escapeHtml(text).replace(/"/g, "&quot;");
    }

    const BLOCK_TAGS = new Set([
        "P",
        "DIV",
        "H1",
        "H2",
        "H3",
        "H4",
        "H5",
        "H6",
        "LI",
        "BLOCKQUOTE",
        "SECTION",
        "ARTICLE",
    ]);
    const SKIP_TAGS = new Set([
        "SVG",
        "PATH",
        "USE",
        "G",
        "DEFS",
        "CLIPPATH",
        "RECT",
        "CIRCLE",
        "BUTTON",
        "SCRIPT",
        "STYLE",
    ]);
    const SKIP_CLASS =
        /\b(related|header|tools|placeholder|base-menu-wrapper|memo-insight-entry|menu-trigger|memo-header-status)\b/;

    const TRAILING_PUNCT = /[.,;:!?，。；：！？、)）\]】]+$/;

    function siyuanTagSpan(name: string): string {
        return `<span data-type="tag">${escapeHtml(name)}</span>`;
    }

    /** 去掉首尾 `#`，得到 flomo / 思源标签名 */
    function unwrapTagName(raw: string): string {
        let name = raw.trim();
        if (name.charAt(0) === "#") {
            if (/^#\s/.test(name)) {
                return "";
            }
            name = name.slice(1);
        }
        if (name.charAt(name.length - 1) === "#") {
            name = name.slice(0, -1);
        }
        return name.replace(TRAILING_PUNCT, "").trim();
    }

    /** 整段文本若是一个 flomo 标签（`#foo` / `#foo/bar`，`#` 后不能有空格），返回标签名 */
    function parseFlomoTagName(raw: string): string {
        const text = raw.trim();
        if (!/^#[^#\s]+#?$/.test(text)) {
            return "";
        }
        return unwrapTagName(text);
    }

    /** 把文本里的 `#标签` 转成思源 `<span data-type="tag">`，其余做 HTML 转义 */
    function convertFlomoTagsInText(text: string): string {
        let result = "";
        const re = /#([^#\s]+)(#)?/g;
        let last = 0;
        let match: RegExpExecArray | null;
        while ((match = re.exec(text)) !== null) {
            result += escapeHtml(text.slice(last, match.index));
            let name = match[1];
            let tail = "";
            if (!match[2]) {
                const punct = name.match(TRAILING_PUNCT);
                if (punct) {
                    tail = punct[0];
                    name = name.slice(0, name.length - tail.length);
                }
            }
            if (!name) {
                result += escapeHtml(match[0]);
            } else {
                result += siyuanTagSpan(name) + escapeHtml(tail);
            }
            last = re.lastIndex;
        }
        result += escapeHtml(text.slice(last));
        return result;
    }

    /** 将 flomo 卡片 HTML 转为思源可插入的段落块（`<br>` / 块级换行都会分段） */
    function htmlToSiYuanBlocks(root: ParentNode, extraImageSrcs: string[]): string {
        const blocks: string[] = [];
        const seenImages = new Set<string>();
        let buffer = "";

        function flush() {
            const html = buffer.replace(/^\s+|\s+$/g, "");
            buffer = "";
            if (!html) {
                return;
            }
            blocks.push(`<p>${html}</p>`);
        }

        function pushImage(src: string) {
            if (!src || seenImages.has(src)) {
                return;
            }
            seenImages.add(src);
            flush();
            blocks.push(`<p><img src="${escapeAttr(src)}"></p>`);
        }

        function isSkippedEl(el: HTMLElement): boolean {
            if (SKIP_TAGS.has(el.tagName)) {
                return true;
            }
            const cls = typeof el.className === "string" ? el.className : "";
            return SKIP_CLASS.test(cls);
        }

        function absUrl(href: string): string {
            if (!href) {
                return "";
            }
            try {
                const url = new URL(href, location.href);
                if (url.protocol !== "http:" && url.protocol !== "https:") {
                    return "";
                }
                return url.href;
            } catch {
                return "";
            }
        }

        /** inner_memo_link 是叠在末词上的空链，把 buffer 里最后一个不在标签内的词包成链接 */
        function wrapTrailingWord(html: string, href: string): string {
            let end = html.length;
            while (end > 0 && /\s/.test(html.charAt(end - 1))) {
                end--;
            }
            if (end === 0) {
                return html;
            }
            const lastLt = html.lastIndexOf("<", end - 1);
            const lastGt = html.lastIndexOf(">", end - 1);
            if (lastLt > lastGt) {
                return html;
            }
            let start = end;
            while (start > 0) {
                const ch = html.charAt(start - 1);
                if (/\s/.test(ch) || ch === ">" || ch === "<") {
                    break;
                }
                start--;
            }
            const word = html.slice(start, end);
            if (!word) {
                return html;
            }
            return `${html.slice(0, start)}<a href="${escapeAttr(href)}">${word}</a>${html.slice(end)}`;
        }

        function walk(node: Node) {
            if (node.nodeType === Node.TEXT_NODE) {
                buffer += convertFlomoTagsInText(node.textContent || "");
                return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE) {
                return;
            }
            const el = node as HTMLElement;
            if (isSkippedEl(el)) {
                return;
            }
            const tag = el.tagName;

            if (tag === "BR") {
                flush();
                return;
            }
            if (tag === "IMG") {
                pushImage(el.getAttribute("src") || "");
                return;
            }
            if (tag === "A") {
                const href = absUrl(el.getAttribute("href") || "");
                const cls = typeof el.className === "string" ? el.className : "";
                if (/\binner_memo_link\b/.test(cls)) {
                    if (href) {
                        buffer = wrapTrailingWord(buffer, href);
                    }
                    return;
                }
                const tagName = parseFlomoTagName(el.textContent || "");
                if (tagName) {
                    buffer += siyuanTagSpan(tagName);
                    return;
                }
                if (!href) {
                    el.childNodes.forEach(walk);
                    return;
                }
                const start = buffer.length;
                el.childNodes.forEach(walk);
                let inner = buffer.slice(start).replace(/^\s+|\s+$/g, "");
                if (!inner) {
                    inner = escapeHtml(href);
                }
                buffer = `${buffer.slice(0, start)}<a href="${escapeAttr(href)}">${inner}</a>`;
                return;
            }
            if (tag === "SPAN") {
                const cls = typeof el.className === "string" ? el.className : "";
                if (/\btag\b/i.test(cls)) {
                    const tagName = parseFlomoTagName(el.textContent || "") || unwrapTagName(el.textContent || "");
                    if (tagName) {
                        buffer += siyuanTagSpan(tagName);
                        return;
                    }
                }
            }
            if (tag === "STRONG" || tag === "B") {
                const start = buffer.length;
                el.childNodes.forEach(walk);
                const inner = buffer.slice(start);
                buffer = `${buffer.slice(0, start)}<strong>${inner}</strong>`;
                return;
            }
            if (tag === "EM" || tag === "I") {
                const start = buffer.length;
                el.childNodes.forEach(walk);
                const inner = buffer.slice(start);
                buffer = `${buffer.slice(0, start)}<em>${inner}</em>`;
                return;
            }
            if (tag === "CODE") {
                buffer += `<code>${escapeHtml(el.textContent || "")}</code>`;
                return;
            }
            if (tag === "UL" || tag === "OL" || tag === "PRE" || tag === "TABLE") {
                flush();
                blocks.push(el.outerHTML);
                return;
            }
            if (BLOCK_TAGS.has(tag)) {
                flush();
                el.childNodes.forEach(walk);
                flush();
                return;
            }
            el.childNodes.forEach(walk);
        }

        root.childNodes.forEach(walk);
        flush();
        extraImageSrcs.forEach(pushImage);
        return blocks.join("");
    }

    function htmlToPlain(html: string): string {
        const wrap = document.createElement("div");
        wrap.innerHTML = html;
        const parts: string[] = [];
        function walkPlain(node: Node) {
            if (node.nodeType === Node.TEXT_NODE) {
                parts.push(node.textContent || "");
                return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE) {
                return;
            }
            const el = node as HTMLElement;
            const tag = el.tagName;
            if (tag === "SPAN" && el.getAttribute("data-type") === "tag") {
                parts.push("#" + (el.textContent || "") + "#");
                return;
            }
            if (tag === "IMG") {
                const src = el.getAttribute("src");
                if (src) {
                    parts.push("![](" + src + ")\n\n");
                }
                return;
            }
            if (tag === "BR") {
                parts.push("\n");
                return;
            }
            el.childNodes.forEach(walkPlain);
            if (tag === "P" || tag === "DIV" || tag === "LI" || tag === "TR") {
                parts.push("\n\n");
            }
        }
        wrap.childNodes.forEach(walkPlain);
        return parts.join("").replace(/\n{3,}/g, "\n\n").trim();
    }

    function getContentEl(memo: Element): ParentNode {
        for (let i = 0; i < CONTENT_SELECTORS.length; i++) {
            const found = memo.querySelector(CONTENT_SELECTORS[i]);
            if (found) {
                return found;
            }
        }
        return memo;
    }

    function getFileImages(memo: Element): string[] {
        const files = memo.querySelector(".files");
        if (!files) {
            return [];
        }
        const srcs: string[] = [];
        files.querySelectorAll("img").forEach((img) => {
            const src = img.getAttribute("src");
            if (src) {
                srcs.push(src);
            }
        });
        return srcs;
    }

    function bindMemo(memo: Element) {
        const el = memo as HTMLElement;
        if (el.dataset.flomoWebDrag === "1") {
            return;
        }
        el.dataset.flomoWebDrag = "1";
        el.setAttribute("draggable", "true");
    }

    function bindMemos(root: ParentNode = document) {
        if (root instanceof Element && root.matches(MEMO_SELECTOR)) {
            bindMemo(root);
        }
        root.querySelectorAll?.(MEMO_SELECTOR).forEach(bindMemo);
    }

    document.addEventListener("dragstart", (event) => {
        const target = event.target as HTMLElement | null;
        const memo = target?.closest?.(MEMO_SELECTOR);
        if (!memo || !event.dataTransfer) {
            return;
        }
        const html = htmlToSiYuanBlocks(getContentEl(memo), getFileImages(memo));
        if (!html) {
            return;
        }
        // HTML 与纯文本各打一个标记，转换后只剩一种格式时仍能识别
        const markedHtml = html.indexOf("<p") === 0 ?
            html.replace("<p", '<p data-flomo-web="1"') :
            `<div data-flomo-web="1">${html}</div>`;
        event.dataTransfer.setData("text/html", markedHtml);
        event.dataTransfer.setData("text/plain", "\u200cflomo-web\u200c\n" + htmlToPlain(html));
        event.dataTransfer.effectAllowed = "copy";
    }, true);

    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    bindMemos(node as Element);
                }
            });
        });
    });
    observer.observe(document.documentElement, {childList: true, subtree: true});
    bindMemos();

    const style = document.createElement("style");
    style.textContent = `
.memo {
    cursor: grab;
}
.memo:active {
    cursor: grabbing;
}
.memo .input-box {
    cursor: auto;
}
`;
    document.documentElement.appendChild(style);
}
