# @nativewindow/webview

## 0.2.1

### Patch Changes

- fix copy/paste keybinds (#8)

## 0.2.0

### Minor Changes

- 7d3bffd: Add `incognito` option to `WindowOptions`.

  When `incognito: true`, the webview runs in private/incognito mode — no cookies, cache, or browsing data are persisted to disk. Each window starts with a clean, isolated session and all data is discarded when the window closes.

  Platform behaviour:
  - **macOS**: `WKWebsiteDataStore.nonPersistentDataStore()` (WKWebView)
  - **Windows**: `IsInPrivateModeEnabled` on the WebView2 controller (InPrivate mode)
  - **Linux**: non-persistent `WebContext` (wry default for incognito)

## 0.1.10

### Patch Changes

- remove macOS Dock icon when last window closes (#6)

## 0.1.9

### Patch Changes

- add clearCookies method, fix native-window import dependency in ipc library

## 0.1.8

### Patch Changes

- fix window close management

## 0.1.7

### Patch Changes

- remove CJS export

## 0.1.5

### Patch Changes

- fix package

## 0.1.4

### Patch Changes

- 16bfa28: bump version after conversion to wry + tao
