---
"@nativewindow/webview": patch
---

Fix unresponsive macOS titlebar buttons by allowing AppKit mouse tracking to finish before returning to the host event loop. Remove the separate CoreFoundation event drain so native input callbacks run while Tao's event handler is attached.
