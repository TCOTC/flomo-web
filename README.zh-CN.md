# flomo 浮墨笔记网页版

在思源的页签或停靠栏中打开 [flomo](https://flomoapp.com/) 网页。

## 使用

1. 启用插件后，点击顶栏左侧的 flomo 图标打开网页页签；右侧停靠栏也可打开，停靠栏始终是首页
2. 在网页中登录 flomo，登录态会记住
3. 编辑器里左键点击 flomo 链接会用新页签打开，可以在插件设置中禁用此功能
4. flomo 域外的链接在系统浏览器打开
5. 把卡片拖进思源编辑器可以插入块，换行会拆成独立段落，图片和录音会在放下后转存为思源资源

本插件功能依赖 Electron 提供的 `<webview>`，所以仅桌面客户端（Windows / macOS / Linux）可用，不支持浏览器端和移动端。

## 兼容性

本插件在停靠栏或页签打开时会接管思源的开发者工具快捷键（Windows / Linux：`Ctrl+Shift+I`，macOS：`Cmd+Option+I`），避免网页抢走。若同时启用了其他使用 `<webview>` 的插件，且焦点在对方网页里，该快捷键仍可能打开对方网页的开发者工具，也可能出现其他未知行为。

## 鸣谢

代码实现参考了 [zuoez02/siyuan-plugin-webview-flomo](https://github.com/zuoez02/siyuan-plugin-webview-flomo)。

## 版权

flomo（浮墨笔记）的名称、商标、网页及应用版权归上海仙蒂网络科技有限公司所有，具有完整的知识产权。本插件为非官方第三方工具，与 flomo 官方无关，仅嵌入其公开网页。
