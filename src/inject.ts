/** 注入 flomo 页面：让卡片可拖拽，并把换行拆成独立段落。 */

export function getFlomoInjectScript(): string {
    // 转成字符串后丢进 webview 执行，flomoInjectMain 不能引用模块作用域
    return `(${flomoInjectMain.toString()})();` + FLOMO_FETCH_BYTES_SCRIPT + GUEST_EXTERNAL_SCRIPT;
}

/** 网页用 console.log 把外链交给宿主；不要改这段前缀 */
export const GUEST_OPEN_PREFIX = "__FLOMO_WEB_OPEN__:";

/**
 * 卡片里的外链多半是同窗 <a>，不会走 window.open，远程 will-navigate 也经常拦不住。
 * 捕获点击后打标记，宿主监听 webview 的 console-message 再交给思源 window.open。
 */
const GUEST_EXTERNAL_SCRIPT = `(function(){
    var PREFIX = ${JSON.stringify(GUEST_OPEN_PREFIX)};
    function isFlomoHref(href) {
        try {
            var url = new URL(href, location.href);
            if (url.protocol !== "http:" && url.protocol !== "https:") {
                return true;
            }
            var host = url.hostname.toLowerCase();
            return host === "flomoapp.com" || host.substring(host.length - 13) === ".flomoapp.com";
        } catch (e) {
            return true;
        }
    }
    function askOpen(href) {
        try {
            var url = new URL(href, location.href);
            if (url.protocol !== "http:" && url.protocol !== "https:") {
                return;
            }
            console.log(PREFIX + url.href);
        } catch (e) {}
    }
    window.open = function(url) {
        if (!url) {
            return window;
        }
        if (isFlomoHref(url)) {
            try {
                location.href = new URL(url, location.href).href;
            } catch (e) {}
        } else {
            askOpen(url);
        }
        return window;
    };
    if (window.__flomoWebOpenBound) {
        return;
    }
    window.__flomoWebOpenBound = true;
    document.addEventListener("click", function(event) {
        if (event.defaultPrevented || event.button !== 0) {
            return;
        }
        var el = event.target;
        if (el && el.nodeType !== 1) {
            el = el.parentElement;
        }
        if (!el || !el.closest) {
            return;
        }
        var a = el.closest("a[href]");
        if (!a) {
            return;
        }
        var href = a.href || a.getAttribute("href") || "";
        if (!href || isFlomoHref(href)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) {
            event.stopImmediatePropagation();
        }
        askOpen(href);
    }, true);
})();`;

/**
 * 必须是字面量脚本：inject 函数里的 async 会被 esbuild（target es6）编成宿主的 __async，
 * guest 里没有这个助手，executeJavaScript 会直接 Script failed to execute。
 */
const FLOMO_FETCH_BYTES_SCRIPT = `(function(){
    window.__flomoWebFetchBytes = function(urls) {
        var out = [];
        var i = 0;
        function bufToB64(buf) {
            var bytes = new Uint8Array(buf);
            var binary = "";
            var chunk = 8192;
            for (var j = 0; j < bytes.length; j += chunk) {
                binary += String.fromCharCode.apply(
                    null,
                    Array.prototype.slice.call(bytes.subarray(j, j + chunk)),
                );
            }
            return btoa(binary);
        }
        function next() {
            if (i >= urls.length) {
                return Promise.resolve(out);
            }
            var url = urls[i++];
            return fetch(url, {credentials: "include"}).then(function(res) {
                if (!res.ok) {
                    out.push({url: url, error: "HTTP " + res.status});
                    return next();
                }
                var mime = ((res.headers.get("content-type") || "").split(";")[0] || "").trim();
                return res.arrayBuffer().then(function(buf) {
                    out.push({url: url, mime: mime, b64: bufToB64(buf)});
                    return next();
                });
            }).catch(function(e) {
                out.push({url: url, error: String(e)});
                return next();
            });
        }
        return next();
    };
})();`;

/** 转存前再打一遍，避免旧注入没有 fetch 助手 */
export function getFlomoFetchBytesScript(): string {
    return FLOMO_FETCH_BYTES_SCRIPT;
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

    function imgSrcOf(el: HTMLElement): string {
        return absUrl(el.getAttribute("src") || el.getAttribute("data-src") || "");
    }

    /** 将 flomo 卡片 HTML 转为思源可插入的段落块（`<br>` / 块级换行都会分段） */
    function htmlToSiYuanBlocks(root: ParentNode, extraImageSrcs: string[], extraAudioSrcs: string[]): string {
        const blocks: string[] = [];
        const seenMedia = new Set<string>();
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
            const abs = absUrl(src);
            if (!abs || seenMedia.has(abs)) {
                return;
            }
            seenMedia.add(abs);
            flush();
            blocks.push(`<p><img src="${escapeAttr(abs)}"></p>`);
        }

        function pushAudio(src: string) {
            const abs = absUrl(src);
            if (!abs || seenMedia.has(abs)) {
                return;
            }
            seenMedia.add(abs);
            flush();
            blocks.push(`<p><audio src="${escapeAttr(abs)}" controls></audio></p>`);
        }

        function isSkippedEl(el: HTMLElement): boolean {
            if (SKIP_TAGS.has(el.tagName)) {
                return true;
            }
            const cls = typeof el.className === "string" ? el.className : "";
            return SKIP_CLASS.test(cls);
        }

        function wrapInline(el: HTMLElement, open: string, close: string, mode: "block" | "inline") {
            const start = buffer.length;
            el.childNodes.forEach((node) => walk(node, mode));
            buffer = `${buffer.slice(0, start)}${open}${buffer.slice(start)}${close}`;
        }

        /** 去掉 flomo 的 data-digits 等属性，交给 Lute 干净的 ol/ul，避免有序列表被收成无序 */
        function serializeList(listEl: HTMLElement): string {
            const tag = listEl.tagName === "OL" ? "ol" : "ul";
            const items: string[] = [];
            Array.from(listEl.children).forEach((child) => {
                if ((child as HTMLElement).tagName !== "LI") {
                    return;
                }
                const saved = buffer;
                buffer = "";
                child.childNodes.forEach((node) => walk(node, "inline"));
                items.push(`<li>${buffer.replace(/^\s+|\s+$/g, "")}</li>`);
                buffer = saved;
            });
            return `<${tag}>${items.join("")}</${tag}>`;
        }

        function walk(node: Node, mode: "block" | "inline") {
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
                if (mode === "block") {
                    flush();
                }
                return;
            }
            if (tag === "IMG") {
                if (mode === "inline") {
                    const src = imgSrcOf(el);
                    if (src && !seenMedia.has(src)) {
                        seenMedia.add(src);
                        buffer += `<img src="${escapeAttr(src)}">`;
                    }
                    return;
                }
                pushImage(imgSrcOf(el));
                return;
            }
            if (tag === "AUDIO") {
                if (mode === "inline") {
                    const src = absUrl(el.getAttribute("src") || "");
                    if (src && !seenMedia.has(src)) {
                        seenMedia.add(src);
                        buffer += `<audio src="${escapeAttr(src)}" controls></audio>`;
                    }
                    return;
                }
                pushAudio(el.getAttribute("src") || "");
                return;
            }
            if (tag === "A") {
                const href = absUrl(el.getAttribute("href") || "");
                const cls = typeof el.className === "string" ? el.className : "";
                if (/\binner_memo_link\b/.test(cls)) {
                    if (href) {
                        buffer += ` <a href="${escapeAttr(href)}">↗️</a>`;
                    }
                    return;
                }
                const tagName = parseFlomoTagName(el.textContent || "");
                if (tagName) {
                    buffer += siyuanTagSpan(tagName);
                    return;
                }
                if (!href) {
                    el.childNodes.forEach((child) => walk(child, mode));
                    return;
                }
                const start = buffer.length;
                el.childNodes.forEach((child) => walk(child, mode));
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
                wrapInline(el, "<strong>", "</strong>", mode);
                return;
            }
            if (tag === "EM" || tag === "I") {
                wrapInline(el, "<em>", "</em>", mode);
                return;
            }
            if (tag === "U") {
                wrapInline(el, "<u>", "</u>", mode);
                return;
            }
            if (tag === "MARK") {
                wrapInline(el, "<mark>", "</mark>", mode);
                return;
            }
            if (tag === "S" || tag === "DEL") {
                wrapInline(el, "<s>", "</s>", mode);
                return;
            }
            if (tag === "CODE") {
                buffer += `<code>${escapeHtml(el.textContent || "")}</code>`;
                return;
            }
            if (tag === "UL" || tag === "OL") {
                const html = serializeList(el);
                if (mode === "inline") {
                    buffer += html;
                    return;
                }
                flush();
                blocks.push(html);
                return;
            }
            if (tag === "PRE" || tag === "TABLE") {
                if (mode === "inline") {
                    buffer += el.outerHTML;
                    return;
                }
                flush();
                blocks.push(el.outerHTML);
                return;
            }
            if (BLOCK_TAGS.has(tag)) {
                if (mode === "inline") {
                    el.childNodes.forEach((child) => walk(child, mode));
                    return;
                }
                flush();
                el.childNodes.forEach((child) => walk(child, mode));
                flush();
                return;
            }
            el.childNodes.forEach((child) => walk(child, mode));
        }

        root.childNodes.forEach((node) => walk(node, "block"));
        flush();
        extraImageSrcs.forEach(pushImage);
        extraAudioSrcs.forEach(pushAudio);
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
            if (tag === "AUDIO") {
                const src = el.getAttribute("src");
                if (src) {
                    parts.push(src + "\n\n");
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

    function collectFileSrcs(memo: Element, selector: string): string[] {
        const files = memo.querySelector(".files");
        if (!files) {
            return [];
        }
        const srcs: string[] = [];
        files.querySelectorAll(selector).forEach((el) => {
            const src = absUrl(el.getAttribute("src") || el.getAttribute("data-src") || "");
            if (src) {
                srcs.push(src);
            }
        });
        return srcs;
    }

    function isMemoEditing(memo: Element): boolean {
        return !!memo.querySelector(".input-box");
    }

    function syncMemoDrag(memo: Element) {
        const el = memo as HTMLElement;
        if (isMemoEditing(el)) {
            el.removeAttribute("draggable");
            return;
        }
        el.setAttribute("draggable", "true");
    }

    function bindMemos(root: ParentNode = document) {
        if (root instanceof Element) {
            const self = root.closest(MEMO_SELECTOR);
            if (self) {
                syncMemoDrag(self);
            }
            if (root.matches(MEMO_SELECTOR)) {
                syncMemoDrag(root);
            }
        }
        root.querySelectorAll?.(MEMO_SELECTOR).forEach(syncMemoDrag);
    }

    document.addEventListener("dragstart", (event) => {
        const target = event.target as HTMLElement | null;
        const memo = target?.closest?.(MEMO_SELECTOR);
        if (!memo || !event.dataTransfer || isMemoEditing(memo)) {
            return;
        }
        const html = htmlToSiYuanBlocks(
            getContentEl(memo),
            collectFileSrcs(memo, "img"),
            collectFileSrcs(memo, "audio"),
        );
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
            mutation.removedNodes.forEach((node) => {
                if (node.nodeType === Node.ELEMENT_NODE && mutation.target instanceof Element) {
                    const memo = mutation.target.closest(MEMO_SELECTOR);
                    if (memo) {
                        syncMemoDrag(memo);
                    }
                }
            });
        });
    });
    observer.observe(document.documentElement, {childList: true, subtree: true});
    bindMemos();

    const style = document.createElement("style");
    style.textContent = `
.memo[draggable="true"] {
    cursor: grab;
}
.memo[draggable="true"]:active {
    cursor: grabbing;
}
.memo .input-box {
    cursor: auto;
}
`;
    document.documentElement.appendChild(style);
}
