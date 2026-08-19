# flomo Web

Open the [flomo](https://flomoapp.com/) web page in a SiYuan tab or dock.

## Usage

1. After enabling the plugin, click the flomo icon on the left of the top bar to open a web tab. You can also open it from the right dock; the dock always shows the home page.
2. Log in to flomo on the web page. Your login state is remembered.
3. Left-clicking a flomo link in the editor opens it in a new tab. You can disable this in the plugin settings.
4. Links outside the flomo domain open in the system browser.
5. Drag a card into the SiYuan editor to insert it as blocks. Line breaks are split into separate paragraphs. Images and recordings are saved as SiYuan assets after the drop.

This plugin's features depend on the `<webview>` provided by Electron, so it is only available on the desktop client (Windows / macOS / Linux) and does not support the browser or mobile.

## Compatibility

While this plugin’s dock or tab is open, it claims SiYuan’s DevTools shortcut (`Ctrl+Shift+I` on Windows/Linux, `Cmd+Option+I` on macOS) so the embedded page cannot steal it. If another plugin that uses `<webview>` is also enabled and focus is in that page, the shortcut may still open that page’s DevTools, and other unknown behavior may occur.

## Acknowledgements

The implementation was written with reference to [zuoez02/siyuan-plugin-webview-flomo](https://github.com/zuoez02/siyuan-plugin-webview-flomo).

## Copyright

The name, trademarks, web pages, and applications of flomo (浮墨笔记) are copyrighted by Shanghai Xiandi Network Technology Co., Ltd., which holds the full intellectual property. This plugin is an unofficial third-party tool, not affiliated with official flomo, and only embeds its public web pages.
