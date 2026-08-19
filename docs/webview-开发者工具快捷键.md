# webview 抢走开发者工具快捷键

**状态：已定。** 只要本插件的停靠栏或页签开着，Windows / Linux 的 `Ctrl+Shift+I`、macOS 的 `Cmd+Option+I` 一律打开**思源**的开发者工具。F12 不是思源快捷键，本插件不拦截。flomo 网页自己的开发者工具只能通过工具栏按钮打开（需在设置里打开「显示开发者工具按钮」）。

官方依据：[webview 标签](https://www.electronjs.org/docs/latest/api/webview-tag)、[webContents](https://www.electronjs.org/docs/latest/api/web-contents)。

---

## 预期行为

| 场景 | 结果 |
| --- | --- |
| 未开本插件，或关掉所有 flomo 页签 / 停靠栏 | 思源菜单加速键照常：`Ctrl+Shift+I` / `Cmd+Option+I` |
| 打开任意一块本插件 webview | 同上，焦点在编辑器或网页里都开思源的 |
| 「显示开发者工具按钮」关着（默认） | 工具栏没有按钮；guest 带 `webpreferences="devTools=no"` |
| 该开关开着 | 工具栏按钮开关 **flomo** 的开发者工具；快捷键仍开思源的 |
| F12 | 不接管。焦点在网页里时，Chromium 可能仍按自己的习惯处理 |

思源本身没有把 F12 绑到开发者工具。官方入口是状态栏「帮助 → 调试」；Electron 应用菜单 `{role: "toggledevtools"}` 才是 `Ctrl+Shift+I` / `Cmd+Option+I`。

---

## 为什么快捷键会被抢走

Electron 官方已不推荐再用 `<webview>`。底层是 Chromium OOPIF：自定义元素 + Shadow DOM 包一层 iframe。思源主窗口开了 `webviewTag: true`，插件才能用。

和快捷键直接相关的约束：

- 点进 webview 后，焦点从宿主挪到访客。思源页面的 `keydown` **收不到** 这些键。
- **不能** 在 webview 元素上监听键盘 / 鼠标 / 滚动。
- 宿主和访客之间的反应都是 **异步** 的。渲染进程里对 `before-input-event` 做 `preventDefault` 赶不上 Chromium。
- 每块 webview 是独立 `WebContents`。开发者工具、菜单加速键都按「当前这块 WebContents」算，不是按「思源窗口」算。
- `webpreferences="devTools=no"` 禁止 `openDevTools()`，**不注销** 加速键：键仍被吞掉，两边都打不开。

按键从外到内：

1. 系统 `globalShortcut`：没焦点也能抢，会误伤别的软件，不能用。
2. 应用菜单 `role: toggledevtools`：目标是 **当前焦点 WebContents**。焦点在 webview 上，toggle 的就是 flomo。
3. Chromium 内置 DevTools 命令：按 WebContents 绑定。
4. 主进程 `before-input-event`：官方拦截点。必须听 **正在收键的那块** `webContents`，监听函数必须跑在主进程。
5. 访客页 JS `keydown`、思源页面 `keydown`：开发者工具键通常到不了。

社区 issue [#14258](https://github.com/electron/electron/issues/14258)：webview 一旦聚焦，键盘被困在里面，这是预期行为。

换嵌入方式：`iframe` 多半会被 flomo 的 `X-Frame-Options` 挡；`WebContentsView` / `BrowserView` 必须在思源主进程里建，插件做不到。

---

## 已经试过、无效或不够的办法

| 做法 | 结果 |
| --- | --- |
| 渲染进程 `event.preventDefault()` | 来不及，无效 |
| 只设 `devTools=no` | 键被吞，两边都打不开 |
| 焦点不在 flomo 时关掉刚打开的访客开发者工具 | 闪一下；还可能关错 dock / 页签 |
| 渲染进程听到快捷键再 `toggle` 思源 | remote 回调晚，而且经常接不到事件 |
| 只听 guest | 焦点在思源时键进窗口，挂钩等于没人处理 |
| 听 guest 再 `toggle`，已打开时再按 | 第一次关已有的思源开发者工具；焦点容易卡在 webview |

---

## 当前实现

插件没有思源的 `main.js` 入口，主进程代码只能 `remote.require` 插件目录里的 `devtools-hook.cjs`。**改这个文件必须完整重启思源**，`remote.require` 会缓存模块。只重载插件不够。

`src/view.ts` 的 `bindGuestDevToolsKeys` 在 `dom-ready` / `did-attach` 后 `hook(webContentsId)`。

主进程同时听三处 `before-input-event`：

1. 思源窗口 `webContents`（焦点在编辑器）
2. 该窗口的开发者工具前端 `devToolsWebContents`（焦点在思源开发者工具里）
3. 本插件的每块 guest

命中快捷键后 `preventDefault`，关掉本插件 guest 的开发者工具，再对宿主窗口做一次防抖 `toggleDevTools()`（80ms），避免 guest 和 host 各触发一次导致开完又关。

工具栏按钮会先 `allowGuestDevTools()`（约 2 秒），这段时间里 guest 的 `devtools-opened` 不会被立刻关掉。

关掉开发者工具按钮时，`<webview>` 必须在 HTML 里一次写好 `webpreferences="devTools=no"`。若用 `createElement` 先写 `src` 再入树，guest 可能已按默认偏好创建。

---

## 和其他 `<webview>` 插件

挂钩挂在**思源窗口**上，只要本插件还有一块 webview，就会接管上述快捷键。焦点若在**别的插件**的 webview 里：本插件不会 hook 那块 guest，对方网页仍可能弹出自己的开发者工具；窗口监听仍在，也可能同时 toggle 思源的。还可能有其他未知行为。本插件全部 webview 都关掉后会卸掉窗口监听。
