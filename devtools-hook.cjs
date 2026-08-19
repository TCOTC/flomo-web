/**
 * 在 Electron 主进程里接管开发者工具快捷键。
 * 焦点在 webview 时键进访客页；焦点在思源时键进窗口。必须两边都听，且只 toggle 一次。
 */
"use strict";

const {webContents} = require("electron");

let hostToggleAt = 0;
let allowGuestUntil = 0;
/** @type {Map<number, {wc: object, onInput: Function, onDestroyed: Function, onDevtoolsOpened: Function}>} */
const hooked = new Map();
/** @type {Map<number, {host: object, onInput: Function, onDtOpened: Function, onDtInput: Function}>} */
const hostBinds = new Map();

/**
 * @param {{type?: string, key?: string, code?: string, shift?: boolean, control?: boolean, alt?: boolean, meta?: boolean, isAutoRepeat?: boolean}} input
 */
function isDevToolsHotkey(input) {
    if (!input || input.type !== "keyDown" || input.isAutoRepeat) {
        return false;
    }
    // 思源只通过 Electron 菜单 role: toggledevtools 绑定开发者工具：
    // Windows / Linux 为 Ctrl+Shift+I，macOS 为 Cmd+Option+I。F12 不是思源快捷键。
    const key = input.key ? String(input.key).toLowerCase() : "";
    const isI = key === "i" || input.code === "KeyI";
    if (!isI) {
        return false;
    }
    if (input.control && input.shift && !input.alt && !input.meta) {
        return true;
    }
    if (input.meta && input.alt && !input.control && !input.shift) {
        return true;
    }
    return false;
}

function hostOfGuest(wc) {
    try {
        const host = wc && wc.hostWebContents;
        if (host && !host.isDestroyed()) {
            return host;
        }
    } catch {
        return undefined;
    }
    return undefined;
}

function closeAllGuests() {
    hooked.forEach((item) => {
        try {
            if (!item.wc.isDestroyed() && item.wc.isDevToolsOpened()) {
                item.wc.closeDevTools();
            }
        } catch {
            return;
        }
    });
}

function toggleHostDevTools(host) {
    const now = Date.now();
    if (now < hostToggleAt) {
        return;
    }
    if (!host || host.isDestroyed()) {
        return;
    }
    hostToggleAt = now + 80;
    host.toggleDevTools();
}

function onHotkey(event, input, host) {
    if (!isDevToolsHotkey(input)) {
        return;
    }
    event.preventDefault();
    closeAllGuests();
    toggleHostDevTools(host);
}

function bindHostHotkey(host) {
    if (!host || host.isDestroyed() || hostBinds.has(host.id)) {
        return;
    }
    const onInput = (event, input) => {
        onHotkey(event, input, host);
    };
    const onDtInput = (event, input) => {
        onHotkey(event, input, host);
    };
    const bindDt = () => {
        try {
            const dt = host.devToolsWebContents;
            if (dt && !dt.isDestroyed()) {
                dt.removeListener("before-input-event", onDtInput);
                dt.on("before-input-event", onDtInput);
            }
        } catch {
            return;
        }
    };
    const onDtOpened = () => {
        bindDt();
    };
    host.on("before-input-event", onInput);
    host.on("devtools-opened", onDtOpened);
    bindDt();
    hostBinds.set(host.id, {host, onInput, onDtOpened, onDtInput});
}

function unbindAllHosts() {
    hostBinds.forEach((item) => {
        try {
            if (!item.host.isDestroyed()) {
                item.host.removeListener("before-input-event", item.onInput);
                item.host.removeListener("devtools-opened", item.onDtOpened);
                const dt = item.host.devToolsWebContents;
                if (dt && !dt.isDestroyed()) {
                    dt.removeListener("before-input-event", item.onDtInput);
                }
            }
        } catch {
            return;
        }
    });
    hostBinds.clear();
}

/** 工具栏按钮打开网页开发者工具前调用，避免被 devtools-opened 立刻关掉 */
function allowGuestDevTools() {
    allowGuestUntil = Date.now() + 2000;
}

/**
 * @param {number} id
 */
function hook(id) {
    const wc = webContents.fromId(id);
    if (!wc || wc.isDestroyed() || hooked.has(id)) {
        return;
    }
    const host = hostOfGuest(wc);
    if (host) {
        bindHostHotkey(host);
    }
    const onInput = (event, input) => {
        onHotkey(event, input, host);
    };
    const onDevtoolsOpened = () => {
        if (Date.now() < allowGuestUntil) {
            return;
        }
        try {
            if (!wc.isDestroyed() && wc.isDevToolsOpened()) {
                wc.closeDevTools();
            }
        } catch {
            return;
        }
        if (host && !host.isDestroyed() && !host.isDevToolsOpened()) {
            host.openDevTools();
        }
    };
    const onDestroyed = () => {
        unhook(id);
    };
    hooked.set(id, {wc, onInput, onDestroyed, onDevtoolsOpened});
    wc.on("before-input-event", onInput);
    wc.on("devtools-opened", onDevtoolsOpened);
    wc.once("destroyed", onDestroyed);
}

/**
 * @param {number} id
 */
function unhook(id) {
    const item = hooked.get(id);
    if (!item) {
        return;
    }
    hooked.delete(id);
    try {
        if (!item.wc.isDestroyed()) {
            item.wc.removeListener("before-input-event", item.onInput);
            item.wc.removeListener("devtools-opened", item.onDevtoolsOpened);
            item.wc.removeListener("destroyed", item.onDestroyed);
        }
    } catch {
        // guest 可能已销毁；hooked 已删，仍要在空表时拆宿主
    }
    if (hooked.size === 0) {
        unbindAllHosts();
    }
}

function unhookAll() {
    for (const id of [...hooked.keys()]) {
        unhook(id);
    }
    unbindAllHosts();
}

module.exports = {hook, unhook, unhookAll, allowGuestDevTools};
