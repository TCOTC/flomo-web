import {fetchPost} from "siyuan";
import type {IProtyle} from "siyuan";
import {getFlomoFetchBytesScript} from "./inject";
import {
    findFlomoWebviews,
    type FlomoPlugin,
    type WebviewEl,
    webviewGuestReady,
} from "./view";

type GuestBytes = {
    url: string;
    mime?: string;
    b64?: string;
    error?: string;
};

function editorRoot(protyle: IProtyle): HTMLElement | null {
    const wysiwyg = protyle.wysiwyg as {element?: HTMLElement;} | undefined;
    return wysiwyg?.element ?? protyle.element.querySelector(".protyle-wysiwyg");
}

function extOf(url: string, mime: string): string {
    const fromMime: Record<string, string> = {
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/png": ".png",
        "image/gif": ".gif",
        "image/webp": ".webp",
        "image/svg+xml": ".svg",
        "audio/mp4": ".m4a",
        "audio/m4a": ".m4a",
        "audio/x-m4a": ".m4a",
        "audio/mpeg": ".mp3",
        "audio/mp3": ".mp3",
        "audio/wav": ".wav",
        "audio/ogg": ".ogg",
        "application/pdf": ".pdf",
    };
    if (mime && fromMime[mime]) {
        return fromMime[mime];
    }
    try {
        const path = new URL(url).pathname;
        const dot = path.lastIndexOf(".");
        if (dot >= 0) {
            const ext = path.slice(dot).toLowerCase();
            if (/^\.[a-z0-9]{2,5}$/.test(ext)) {
                return ext;
            }
        }
    } catch {
        // 用 mime 默认
    }
    if (mime.indexOf("audio/") === 0) {
        return ".m4a";
    }
    return ".bin";
}

function b64ToBlob(b64: string, mime: string): Blob {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], {type: mime || "application/octet-stream"});
}

function collectHttpSrcs(root: ParentNode): string[] {
    const urls: string[] = [];
    const seen = new Set<string>();
    root.querySelectorAll("img[src], audio[src]").forEach((el) => {
        const src = el.getAttribute("src") || "";
        if (!src || seen.has(src)) {
            return;
        }
        if (src.indexOf("http://") !== 0 && src.indexOf("https://") !== 0) {
            return;
        }
        seen.add(src);
        urls.push(src);
    });
    return urls;
}

async function fetchGuestBytes(plugin: FlomoPlugin, urls: string[]): Promise<Map<string, {mime: string; blob: Blob;}>> {
    const map = new Map<string, {mime: string; blob: Blob;}>();
    if (urls.length === 0) {
        return map;
    }
    let view: WebviewEl | undefined;
    findFlomoWebviews().forEach((el) => {
        if (!view && webviewGuestReady(el)) {
            view = el;
        }
    });
    if (!view) {
        return map;
    }
    let rows: GuestBytes[];
    try {
        await view.executeJavaScript(getFlomoFetchBytesScript());
        rows = await view.executeJavaScript(
            `window.__flomoWebFetchBytes(${JSON.stringify(urls)})`,
        ) as GuestBytes[];
    } catch (e) {
        console.error(`${plugin.displayName}: fetch guest bytes failed`, e);
        return map;
    }
    if (!Array.isArray(rows)) {
        return map;
    }
    rows.forEach((row) => {
        if (!row?.url || !row.b64) {
            if (row?.error) {
                console.error(`${plugin.displayName}: fetch ${row.url}: ${row.error}`);
            }
            return;
        }
        const mime = row.mime || "application/octet-stream";
        map.set(row.url, {mime, blob: b64ToBlob(row.b64, mime)});
    });
    return map;
}

function uploadBlob(plugin: FlomoPlugin, blob: Blob, filename: string, docId?: string): Promise<string> {
    const body = new FormData();
    body.append("file[]", blob, filename);
    if (docId) {
        body.append("id", docId);
    }
    return fetch("/api/asset/upload", {method: "POST", body}).then(async (res) => {
        const json = await res.json() as {
            code?: number;
            msg?: string;
            data?: {succMap?: Record<string, string>;};
        };
        if (!res.ok || json.code) {
            throw new Error(json.msg || res.statusText);
        }
        const succ = json.data?.succMap || {};
        let path = succ[filename];
        if (!path) {
            for (const key in succ) {
                if (Object.prototype.hasOwnProperty.call(succ, key)) {
                    path = succ[key];
                    break;
                }
            }
        }
        if (!path) {
            throw new Error("upload returned empty succMap");
        }
        return path.startsWith("assets/") || path.startsWith("/") ? path : `assets/${path}`;
    }).catch((e) => {
        console.error(`${plugin.displayName}: upload ${filename} failed`, e);
        return "";
    });
}

function replaceMediaSrc(root: Element, fromTo: Map<string, string>): boolean {
    let changed = false;
    root.querySelectorAll("img[src], audio[src]").forEach((el) => {
        const src = el.getAttribute("src") || "";
        const next = fromTo.get(src);
        if (!next) {
            return;
        }
        el.setAttribute("src", next);
        if (el.hasAttribute("data-src")) {
            el.setAttribute("data-src", next);
        }
        changed = true;
    });
    return changed;
}

function waitForBlock(protyle: IProtyle, id: string): Promise<HTMLElement | null> {
    const root = editorRoot(protyle);
    if (!root) {
        return Promise.resolve(null);
    }
    const found = root.querySelector(`[data-node-id="${id}"]`) as HTMLElement | null;
    if (found) {
        return Promise.resolve(found);
    }
    return new Promise((resolve) => {
        let tries = 0;
        const timer = window.setInterval(() => {
            const el = root.querySelector(`[data-node-id="${id}"]`) as HTMLElement | null;
            tries++;
            if (el || tries >= 20) {
                window.clearInterval(timer);
                resolve(el);
            }
        }, 50);
    });
}

/** 插入后把远程图 / 录音转成思源 assets，再写回块 DOM */
export function localizePastedAssets(options: {
    plugin: FlomoPlugin;
    protyle: IProtyle;
    blockIds: string[];
    wrap: HTMLElement;
}): void {
    const urls = collectHttpSrcs(options.wrap);
    if (urls.length === 0) {
        return;
    }
    const {plugin, protyle, blockIds} = options;
    void (async () => {
        const bytes = await fetchGuestBytes(plugin, urls);
        if (bytes.size === 0) {
            return;
        }
        const fromTo = new Map<string, string>();
        let index = 0;
        for (const url of urls) {
            const item = bytes.get(url);
            if (!item) {
                continue;
            }
            index++;
            const filename = `flomo-${Date.now()}-${index}${extOf(url, item.mime)}`;
            const path = await uploadBlob(plugin, item.blob, filename, protyle.block.rootID);
            if (path) {
                fromTo.set(url, path);
            }
        }
        if (fromTo.size === 0) {
            return;
        }
        for (const id of blockIds) {
            const el = await waitForBlock(protyle, id);
            if (!el || !replaceMediaSrc(el, fromTo)) {
                continue;
            }
            fetchPost("/api/block/updateBlock", {
                id,
                dataType: "dom",
                data: el.outerHTML,
            });
        }
    })();
}
