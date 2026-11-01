# @nativewindow/webview

## 1.0.7

### Patch Changes

- Disable release symbol stripping to prevent malformed macOS addon binaries that fail to load in Node.
- 097f335: Fix unresponsive macOS titlebar buttons by allowing AppKit mouse tracking to finish before returning to the host event loop. Remove the separate CoreFoundation event drain so native input callbacks run while Tao's event handler is attached.
- 8c81cbb: Update Tao to 0.37.2 and Wry to 0.57.1, with matching Windows and WebView2 bindings. Remove Wry's retired protocol feature flag; custom protocols remain supported.

## 1.0.6

### Patch Changes

- bump versions, fix multiwindow closing events

## 1.0.5

### Patch Changes

- remove native-window.js

## 1.0.4

### Patch Changes

- bump

## 1.0.3

### Patch Changes

- bump rust dependencies

## 1.0.2

### Patch Changes

- bump dependencies, add default export for webview, add fuzz testing

## 0.1.1

- initial release
