<p align="center">
  <img src="https://fcannizzaro.com/_astro/native-window.IZZgO9dh.webp" alt="native-window" />
</p>

# @nativewindow/webview

[![CI](https://github.com/nativewindow/webview/actions/workflows/ci.yml/badge.svg)](https://github.com/nativewindow/webview/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@nativewindow/webview?label=@nativewindow/webview)](https://www.npmjs.com/package/@nativewindow/webview)
[![npm](https://img.shields.io/npm/v/@nativewindow/ipc?label=@nativewindow/ipc)](https://www.npmjs.com/package/@nativewindow/ipc)
[![npm](https://img.shields.io/npm/v/@nativewindow/react?label=@nativewindow/react)](https://www.npmjs.com/package/@nativewindow/react)
[![npm](https://img.shields.io/npm/v/@nativewindow/tsdb?label=@nativewindow/tsdb)](https://www.npmjs.com/package/@nativewindow/tsdb)

> [!NOTE]
> This project is in **beta**. APIs may change without notice and some features may be incomplete or unstable.

Native OS webviews for Bun, Deno & Node.js. Create real desktop windows with embedded web content using [wry](https://github.com/tauri-apps/wry) + [tao](https://github.com/tauri-apps/tao) — providing WebKit on macOS and Linux, and WebView2 on Windows.

## Features

- **Native webviews** — powered by [wry](https://github.com/tauri-apps/wry) + [tao](https://github.com/tauri-apps/tao) (WebKit on macOS/Linux, WebView2 on Windows), no Electron or Chromium bundled
- **Multi-window** — create and manage multiple independent windows
- **HTML & URL loading** — load inline HTML strings or navigate to URLs
- **Bidirectional IPC** — send messages between Bun/Deno/Node and the webview
- **Typesafe IPC channels** — typed message layer with schema-based validation and compile-time checked event maps
- **Full window control** — title, size, position, min/max size, decorations, transparency, always-on-top
- **Window events** — close, resize, move, focus, blur, page load, title change
- **Rust + napi-rs + wry + tao** — high-performance native addon, no runtime overhead
- **Runtime detection** — check for WebView2 availability and auto-install on Windows

## Packages

| Package                                                     | Description                                               |
| ----------------------------------------------------------- | --------------------------------------------------------- |
| [`@nativewindow/webview`](./packages/webview)         | Rust napi-rs addon providing native window + webview APIs |
| [`@nativewindow/ipc`](./packages/ipc)         | Pure TypeScript typesafe IPC channel layer                |
| [`@nativewindow/react`](./packages/react) | React bindings for the typed IPC layer                    |
| [`@nativewindow/tsdb`](./packages/tsdb)       | TanStack DB collection adapter for native-window IPC      |

## Quick Start

```ts
import { init, pumpEvents, NativeWindow } from "native-window";

init();
const pump = setInterval(() => pumpEvents(), 16);

const win = new NativeWindow({
  title: "My App",
  width: 800,
  height: 600,
});

win.loadHtml(`
  <h1>Hello from native webview!</h1>
  <button onclick="window.ipc.postMessage('clicked')">Click me</button>
`);

win.onMessage((msg) => {
  console.log("From webview:", msg);
  win.postMessage(`Echo: ${msg}`);
});

win.onClose(() => {
  clearInterval(pump);
  process.exit(0);
});
```

## Typed IPC

Use `native-window-ipc` for compile-time checked messaging between Bun/Deno/Node and the webview. Schemas provide both types and runtime validation.

### Host side (Bun/Deno/Node)

```ts
import { z } from "zod";
import { createWindow } from "@nativewindow/ipc";

const ch = createWindow(
  { title: "Typed IPC" },
  {
    schemas: {
      // host -> webview
      host: {
        "update-title": z.string(),
      },
      // webview -> host
      client: {
        "user-click": z.object({ x: z.number(), y: z.number() }),
        counter: z.number(),
      },
    },
  },
);

// Receive typed messages from the webview (client events)
ch.on("user-click", (pos) => {
  // pos: { x: number; y: number }
  console.log(`Click at ${pos.x}, ${pos.y}`);
});

ch.on("counter", (n) => {
  // n: number
  ch.send("update-title", `Count: ${n}`);
});

// ch.send("counter", "wrong");      // Type error: "counter" is a client event
// ch.send("typo", 123);             // Type error: "typo" does not exist

ch.window.loadHtml(`<html>...</html>`);
```

### Webview side (inline HTML)

The `__channel__` object is auto-injected by `createWindow` / `createChannel`:

```html
<script>
  __channel__.send("user-click", { x: 10, y: 20 });
  __channel__.on("update-title", (title) => {
    document.title = title;
  });
</script>
```

### Webview side (bundled app)

For webview apps bundled with their own build step, import the client directly:

```ts
import { z } from "zod";
import { createChannelClient } from "@nativewindow/ipc/client";

const ch = createChannelClient({
  schemas: {
    host: {
      "update-title": z.string(),
    },
    client: {
      counter: z.number(),
    },
  },
});

// Send client events to the host
ch.send("counter", 42); // Typed!

// Receive host events from the host
ch.on("update-title", (t) => {
  // t: string
  document.title = t;
});
```

## Runtime Detection

On Windows 10, the WebView2 runtime may not be installed. Use `checkRuntime()` to detect it and `ensureRuntime()` to auto-install if missing.

```ts
import { checkRuntime, ensureRuntime } from "native-window";

const info = checkRuntime();
console.log(info);
// { available: true, version: "128.0.2739.42", platform: "windows" }
// { available: false, version: undefined, platform: "windows" }
// { available: true,  version: undefined,        platform: "macos" }
// { available: true,  version: undefined,        platform: "linux" }

if (!info.available) {
  console.log("WebView2 not found, installing...");
  const result = ensureRuntime(); // downloads ~2MB bootstrapper, runs silently
  console.log("Installed:", result.version);
}
```

On macOS, both functions return `{ available: true }` immediately — WKWebView is a system framework. On Linux, both functions also return `{ available: true }` — WebKitGTK is assumed to be installed. On Windows 11, WebView2 is pre-installed.

## API Reference

### `native-window`

#### `init()`

Initialize the native window system. Must be called once before creating any windows.

#### `pumpEvents()`

Process pending native UI events. Call periodically (~16ms via `setInterval`) to keep windows responsive.

#### `checkRuntime(): RuntimeInfo`

Check if the native webview runtime is available. Returns `{ available: boolean, version?: string, platform: "macos" | "windows" | "linux" | "unsupported" }`.

#### `ensureRuntime(): RuntimeInfo`

Check for the runtime and install it if missing (Windows only). Downloads the WebView2 Evergreen Bootstrapper (~2MB) from Microsoft and runs it silently. Throws on failure.

#### `new NativeWindow(options?)`

Create a native window with an embedded webview.

**WindowOptions:**

| Option                   | Type      | Default | Description                   |
| ------------------------ | --------- | ------- | ----------------------------- |
| `title`                  | `string`  | `""`    | Window title                  |
| `width`                  | `number`  | `800`   | Inner width (logical pixels)  |
| `height`                 | `number`  | `600`   | Inner height (logical pixels) |
| `x`                      | `number`  | —       | X position                    |
| `y`                      | `number`  | —       | Y position                    |
| `minWidth` / `minHeight` | `number`  | —       | Minimum size                  |
| `maxWidth` / `maxHeight` | `number`  | —       | Maximum size                  |
| `resizable`              | `boolean` | `true`  | Allow resizing                |
| `decorations`            | `boolean` | `true`  | Show title bar and borders    |
| `transparent`            | `boolean` | `false` | Transparent background        |
| `alwaysOnTop`            | `boolean` | `false` | Float above other windows     |
| `visible`                | `boolean` | `true`  | Initially visible             |
| `devtools`               | `boolean` | `false` | Enable devtools               |

**Content methods:**

| Method                      | Description                                                  |
| --------------------------- | ------------------------------------------------------------ |
| `loadUrl(url)`              | Navigate to a URL                                            |
| `loadHtml(html)`            | Load an HTML string                                          |
| `unsafe.evaluateJs(script)` | Execute JS in the webview (fire-and-forget)                  |
| `postMessage(msg)`          | Send a string to the webview via `window.__native_message__` |

**Window control:**

| Method                                       | Description                  |
| -------------------------------------------- | ---------------------------- |
| `setTitle(title)`                            | Set the window title         |
| `setSize(w, h)`                              | Set the window size          |
| `setMinSize(w, h)` / `setMaxSize(w, h)`      | Set size constraints         |
| `setPosition(x, y)`                          | Set window position          |
| `setResizable(bool)`                         | Toggle resizability          |
| `setDecorations(bool)`                       | Toggle decorations           |
| `setAlwaysOnTop(bool)`                       | Toggle always-on-top         |
| `show()` / `hide()`                          | Show or hide the window      |
| `close()`                                    | Close and destroy the window |
| `focus()`                                    | Bring the window to focus    |
| `maximize()` / `minimize()` / `unmaximize()` | Window state                 |

**Events:**

| Method                       | Callback signature                                      |
| ---------------------------- | ------------------------------------------------------- |
| `onMessage(cb)`              | `(message: string) => void`                             |
| `onClose(cb)`                | `() => void`                                            |
| `onResize(cb)`               | `(width: number, height: number) => void`               |
| `onMove(cb)`                 | `(x: number, y: number) => void`                        |
| `onFocus(cb)` / `onBlur(cb)` | `() => void`                                            |
| `onPageLoad(cb)`             | `(event: "started" \| "finished", url: string) => void` |
| `onTitleChanged(cb)`         | `(title: string) => void`                               |

### `native-window-ipc`

#### `createChannel<S>(win, options): NativeWindowChannel<InferSchemaMap<S>>`

Wrap an existing `NativeWindow` with a typed message channel. Schemas are required. Auto-injects the webview client script (disable with `{ injectClient: false }`).

#### `createWindow<S>(windowOptions, channelOptions): NativeWindowChannel<InferSchemaMap<S>>`

Convenience: creates a `NativeWindow` and wraps it with `createChannel`.

#### `getClientScript(): string`

Returns the webview-side client as a self-contained JS string for manual injection.

#### `createChannelClient<S>(options): TypedChannel<InferSchemaMap<S>>` (from `native-window-ipc/client`)

Create a typed channel client inside the webview. Schemas are required. For use in bundled webview apps.

#### `TypedChannel<T>`

```ts
interface TypedChannel<T extends EventMap> {
  send<K extends keyof T & string>(type: K, payload: T[K]): void;
  on<K extends keyof T & string>(type: K, handler: (payload: T[K]) => void): void;
  off<K extends keyof T & string>(type: K, handler: (payload: T[K]) => void): void;
}
```

## Security

All security hardening is compiled in by default on all supported platforms — no build-time feature flags required.

- **URL scheme blocking** — `javascript:`, `file:`, `data:`, and `blob:` navigations are blocked at the native layer
- **Content Security Policy** — inject a CSP via the `csp` option in `WindowOptions`
- **Trusted origin filtering** — restrict IPC messages and client injection to specific origins at the native and IPC layers
- **Webview surface hardening** — context menus, status bar, and built-in error page are disabled on Windows
- **IPC bridge hardening** — `window.ipc` and `window.__channel__` are frozen, non-writable objects
- **Message size limits** — 10 MB hard limit at the native layer, configurable 1 MB default at the IPC layer
- **Schema-based validation** — all incoming IPC payloads are validated at runtime against user-defined schemas

See the [Security documentation](https://native-window.dev/docs/security) for the full threat model and best practices.

## Building

### Prerequisites

- [Bun](https://bun.sh) (v1.3+), [Deno](https://deno.com) (v2+), or [Node.js](https://nodejs.org) (v18+)
- [Rust](https://rustup.rs) (stable)
- macOS, Windows, or Linux (for native compilation)
- On Linux: WebKitGTK development headers (e.g. `libwebkit2gtk-4.1-dev` on Ubuntu/Debian)

### Install dependencies

```bash
bun install
# or
deno install
```

### Build the native addon

```bash
cd packages/webview
bun run build          # release build
bun run build:debug    # debug build
```

The build targets the current platform. Cross-compilation targets are configured in `packages/webview/package.json` under `napi.triples`.

## Samples

```bash
# Raw IPC example
bun samples/basic.ts

# Typed IPC example
bun samples/typed-ipc.ts
```

## Testing

```bash
# Run the IPC channel tests
cd packages/ipc
bun test
```

## Known Limitations

- **~16ms event latency** from the `pumpEvents()` polling interval
- **HTML null origin** — content loaded via `loadHtml()` has a null CORS origin; use a custom protocol or `loadUrl()` for fetch/XHR
- **Windows 10** may require the [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) — use `ensureRuntime()` to auto-install (included by default on Windows 11)
- **Linux** requires [WebKitGTK](https://webkitgtk.org/) to be installed (e.g. `libwebkit2gtk-4.1-dev` on Ubuntu/Debian)
- **No return values from `unsafe.evaluateJs()`** — use `postMessage`/`onMessage` to send results back
- **2 MB HTML limit on Windows** when using `loadHtml()`
- **Use `bun --watch`** instead of `bun --hot` for development (native addon reloading requires a process restart)

## License

MIT
