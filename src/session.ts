import {
    showMessage,
    type Plugin,
} from "siyuan";

export const STORAGE_SESSION = "session.json";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 运行中只认第一次成功的 ID，同步改 session.json 也不换桶 */
let sessionId: string | undefined;
let pending: Promise<string> | undefined;

export function parseSessionId(data: unknown): string | undefined {
    if (!data || typeof data !== "object") {
        return undefined;
    }
    const raw = (data as {id?: unknown;}).id;
    if (typeof raw !== "string" || !UUID_RE.test(raw)) {
        return undefined;
    }
    return raw;
}

export function sessionPartition(id: string): string {
    return `persist:flomo-web-${id}`;
}

export function peekSessionPartition(): string | undefined {
    return sessionId ? sessionPartition(sessionId) : undefined;
}

/** 分区名在第一次导航前必须定死；未就绪时不要建 webview */
export function getWebviewPartition(): string {
    if (!sessionId) {
        throw new Error("flomo-web: session id not ready");
    }
    return sessionPartition(sessionId);
}

function createSessionId(): string {
    return crypto.randomUUID();
}

function report(plugin: Plugin, action: string, e: {msg?: string;} | unknown) {
    const errorMessage = `${plugin.displayName}: failed to ${action} data [${STORAGE_SESSION}]: ${
        (e as {msg?: string;}).msg || e
    }`;
    showMessage(errorMessage);
    console.error(errorMessage);
}

async function loadOrCreate(plugin: Plugin): Promise<string> {
    let existing: string | undefined;
    try {
        existing = parseSessionId(await plugin.loadData(STORAGE_SESSION));
    } catch (e) {
        report(plugin, "load", e);
    }
    if (existing) {
        return existing;
    }
    const created = createSessionId();
    try {
        await plugin.saveData(STORAGE_SESSION, {id: created});
    } catch (e) {
        report(plugin, "save", e);
    }
    return created;
}

/** 没有就生成并写入 session.json；已有内存 ID 时不再读盘 */
export function ensureSession(plugin: Plugin): Promise<string> {
    if (sessionId) {
        return Promise.resolve(sessionId);
    }
    if (!pending) {
        pending = loadOrCreate(plugin).then((id) => {
            sessionId = id;
            return id;
        }, (e) => {
            pending = undefined;
            throw e;
        });
    }
    return pending;
}
