// ── @nativewindow/webview ────────────────────────────────────────────
//
// Single-file entry point for the native webview package.
//
// Contains:
// - Platform-specific .node binary loader
// - Type definitions (WindowOptions, CookieInfo, RuntimeInfo, etc.)
// - NativeWindow export and instance type alias
// - Utility exports (checkRuntime, ensureRuntime, sanitizeForJs, etc.)
//
// Bundler integration:
// A Vite plugin (or similar) can virtualize this module to replace
// the native loader with a custom strategy (e.g. runtime download
// of the matching platform-arch .node file).

import { createRequire } from "node:module";

const _require = createRequire(import.meta.url);

// ── Platform map ────────────────────────────────────────────────────

const _platforms: Record<string, { pkg: string; file: string }> = {
  "darwin-arm64": {
    pkg: "@nativewindow/webview-darwin-arm64",
    file: "native-window.darwin-arm64.node",
  },
  "darwin-x64": {
    pkg: "@nativewindow/webview-darwin-x64",
    file: "native-window.darwin-x64.node",
  },
  "win32-x64": {
    pkg: "@nativewindow/webview-win32-x64-msvc",
    file: "native-window.win32-x64-msvc.node",
  },
  "win32-arm64": {
    pkg: "@nativewindow/webview-win32-arm64-msvc",
    file: "native-window.win32-arm64-msvc.node",
  },
  "linux-x64": {
    pkg: "@nativewindow/webview-linux-x64-gnu",
    file: "native-window.linux-x64-gnu.node",
  },
  "linux-arm64": {
    pkg: "@nativewindow/webview-linux-arm64-gnu",
    file: "native-window.linux-arm64-gnu.node",
  },
};

// ── Types ───────────────────────────────────────────────────────────

/** @internal Shape of the raw native addon exports. */
interface NativeBindings {
  NativeWindow: NativeWindowConstructor;
  pumpEvents: () => void;
  checkRuntime: () => RuntimeInfo;
  ensureRuntime: () => RuntimeInfo;
  loadHtmlOrigin: () => string;
  sanitizeForJs: (input: string) => string;
}

/** Information about the native webview runtime. */
export interface RuntimeInfo {
  /** Whether the webview runtime is available. */
  available: boolean;
  /** The version string of the runtime, if detected. */
  version?: string;
  /** The current platform: "macos", "windows", "linux", or "unsupported". */
  platform: "macos" | "windows" | "linux" | "unsupported";
}

/**
 * Information about a cookie from the native cookie store.
 * Includes `HttpOnly` cookies that are invisible to `document.cookie`.
 */
export interface CookieInfo {
  /** Cookie name. */
  name: string;
  /** Cookie value. */
  value: string;
  /** Domain the cookie belongs to. */
  domain: string;
  /** Path the cookie is restricted to. */
  path: string;
  /** Whether the cookie is HttpOnly (inaccessible to JS). */
  httpOnly: boolean;
  /** Whether the cookie requires HTTPS. */
  secure: boolean;
  /** SameSite policy: "Strict", "Lax", "None", or null for unset. */
  sameSite: string | null;
  /** Expiry as Unix timestamp (seconds). Null for session cookies. */
  expires: number | null;
}

/** @internal Constructor type for the raw native NativeWindow class. */
interface NativeWindowConstructor {
  new (options?: WindowOptions): NativeWindowInstance;
}

/** @internal Instance type for the raw native NativeWindow class. */
interface NativeWindowInstance {
  readonly id: number;
  loadUrl(url: string): void;
  loadHtml(html: string): void;
  evaluateJs(script: string): void;
  postMessage(message: string): void;
  setTitle(title: string): void;
  setSize(width: number, height: number): void;
  setMinSize(width: number, height: number): void;
  setMaxSize(width: number, height: number): void;
  setPosition(x: number, y: number): void;
  setResizable(resizable: boolean): void;
  setDecorations(decorations: boolean): void;
  setAlwaysOnTop(alwaysOnTop: boolean): void;
  setIcon(path: string): void;
  show(): void;
  hide(): void;
  close(): void;
  focus(): void;
  maximize(): void;
  minimize(): void;
  unmaximize(): void;
  reload(): void;
  onMessage(callback: (message: string, sourceUrl: string) => void): void;
  onClose(callback: () => void): void;
  onResize(callback: (width: number, height: number) => void): void;
  onMove(callback: (x: number, y: number) => void): void;
  onFocus(callback: () => void): void;
  onBlur(callback: () => void): void;
  onPageLoad(callback: (event: "started" | "finished", url: string) => void): void;
  onTitleChanged(callback: (title: string) => void): void;
  onReload(callback: () => void): void;
  onNavigationBlocked(callback: (url: string) => void): void;
  getCookies(url?: string): CookieInfo[];
  clearCookies(host?: string): void;
  openDevtools(): void;
  closeDevtools(): void;
  isDevtoolsOpen(): boolean;
}

/**
 * Options for creating a new native window.
 *
 * Security: When loading untrusted content, use the `csp` field to restrict
 * what the page can do. Without a CSP, loaded content can execute inline
 * scripts and load resources from any origin.
 */
export interface WindowOptions {
  /** Window title. Default: "" */
  title?: string;
  /** Inner width in logical pixels. Default: 800 */
  width?: number;
  /** Inner height in logical pixels. Default: 600 */
  height?: number;
  /** X position in screen coordinates */
  x?: number;
  /** Y position in screen coordinates */
  y?: number;
  /** Minimum inner width */
  minWidth?: number;
  /** Minimum inner height */
  minHeight?: number;
  /** Maximum inner width */
  maxWidth?: number;
  /** Maximum inner height */
  maxHeight?: number;
  /** Allow resizing. Default: true */
  resizable?: boolean;
  /** Show window decorations (title bar, borders). Default: true */
  decorations?: boolean;
  /** Transparent window background. Default: false */
  transparent?: boolean;
  /** Always on top of other windows. Default: false */
  alwaysOnTop?: boolean;
  /** Initially visible. Default: true */
  visible?: boolean;
  /** Enable devtools. Default: false */
  devtools?: boolean;
  /**
   * Content Security Policy to inject at document start.
   * When set, a `<meta http-equiv="Content-Security-Policy">` tag is injected
   * before any page scripts run.
   *
   * **Limitation:** The CSP is applied via a `<meta>` tag at `DOMContentLoaded`,
   * so scripts executing before that event are not restricted. Meta-tag CSP also
   * cannot enforce `frame-ancestors` or `report-uri` directives. For stronger
   * enforcement, serve pages via the custom protocol handler with a real HTTP
   * `Content-Security-Policy` header.
   *
   * @example `"default-src 'self'; script-src 'self' 'unsafe-inline'"`
   */
  csp?: string;
  /**
   * Trusted origins for IPC messages at the native layer.
   * When set, only messages whose source URL origin matches one of these
   * entries are forwarded to the host. Messages from other origins are
   * silently dropped.
   *
   * Each entry should be a full origin string (scheme + host + optional port),
   * e.g. `"https://example.com"`. No trailing slash.
   *
   * @security Defense-in-depth. For application-level origin filtering,
   * use `trustedOrigins` in `createChannel()` from `native-window-ipc`.
   *
   * @example `["https://myapp.com", "https://cdn.myapp.com"]`
   */
  trustedOrigins?: string[];
  /**
   * Allowed hosts for navigation restriction.
   * When set and non-empty, ALL navigations (including `loadUrl()`, link
   * clicks, form submissions, and redirects) are restricted to URLs whose
   * host matches one of these patterns.
   *
   * Supports wildcard prefixes: `"*.example.com"` matches any subdomain
   * of `example.com` and `example.com` itself.
   *
   * Internal navigations (`about:blank`, `loadHtml()` content) are always
   * permitted. When unset or empty, all hosts are allowed.
   *
   * @example `["myapp.com", "*.cdn.myapp.com"]`
   */
  allowedHosts?: string[];
  /**
   * Allow the webview to access the camera when requested.
   * Default: false (all camera requests are denied).
   * @note Not yet enforced in the wry backend. The OS default (prompt user) applies.
   */
  allowCamera?: boolean;
  /**
   * Allow the webview to access the microphone when requested.
   * Default: false (all microphone requests are denied).
   * @note Not yet enforced in the wry backend. The OS default (prompt user) applies.
   */
  allowMicrophone?: boolean;
  /**
   * Allow the webview to use the File System Access API
   * (`showOpenFilePicker`, `showSaveFilePicker`, `showDirectoryPicker`).
   * Default: false (all file system access requests are denied).
   * @note Not yet enforced in the wry backend. The OS default applies.
   */
  allowFileSystem?: boolean;
  /**
   * Path to a PNG or ICO file for the window icon (title bar).
   * On macOS this option is silently ignored (macOS doesn't support
   * per-window icons). Relative paths resolve from the working directory.
   */
  icon?: string;
  /**
   * Run the webview in incognito (private) mode.
   * When `true`, no cookies, cache, or other browsing data are persisted to disk.
   * Each window starts with a clean, isolated session and all data is discarded
   * when the window closes.
   *
   * Platform notes:
   * - **macOS**: Uses `WKWebsiteDataStore.nonPersistentDataStore()` (WKWebView).
   * - **Windows**: Enables `IsInPrivateModeEnabled` on the WebView2 controller.
   * - **Linux**: Uses a temporary in-memory WebContext (no persistent storage).
   *
   * Default: `false`
   */
  incognito?: boolean;
}

// ── Native loader ───────────────────────────────────────────────────

function _tryRequire(id: string): NativeBindings | null {
  try {
    return _require(id) as NativeBindings;
  } catch {
    return null;
  }
}

const _platformKey = `${process.platform}-${process.arch}`;
const _entry = _platforms[_platformKey];

if (!_entry) {
  throw new Error(`Unsupported platform: ${_platformKey}`);
}

const _nativeBinding =
  _tryRequire(`./${_entry.file}`) ?? // same directory (source / package root)
  _tryRequire(`../${_entry.file}`) ?? // parent directory (when loaded from dist/)
  _tryRequire(_entry.pkg); // per-platform npm package (production)

if (!_nativeBinding) {
  throw new Error(
    `Failed to load native binding for platform: ${_platformKey}. ` +
      `Ensure the correct platform package is installed or the .node file exists.`,
  );
}

// ── Exports ─────────────────────────────────────────────────────────

/** {@inheritDoc RuntimeInfo} */
export const checkRuntime = _nativeBinding.checkRuntime;

/** {@inheritDoc RuntimeInfo} */
export const ensureRuntime = _nativeBinding.ensureRuntime;

/**
 * Returns the origin of pages loaded via `loadHtml()`.
 *
 * This is the origin string to use in `trustedOrigins` when restricting
 * IPC messages to only accept messages from `loadHtml()` content.
 *
 * - macOS/Linux: `"nativewindow://localhost"`
 * - Windows: `"https://nativewindow.localhost"`
 */
export const loadHtmlOrigin = _nativeBinding.loadHtmlOrigin;

/**
 * Escape a string for safe embedding inside a JavaScript string literal.
 * Handles backslashes, double quotes, newlines, carriage returns, null
 * bytes, closing `</script>` tags, Unicode line/paragraph separators
 * (U+2028, U+2029), backticks, and `${` template expressions.
 *
 * Safe for use in double-quoted, single-quoted, and template literal
 * contexts.
 *
 * @example
 * ```ts
 * import { NativeWindow, sanitizeForJs } from "@nativewindow/webview";
 *
 * const userInput = 'He said "hello"\n<script>alert(1)</script>';
 * win.evaluateJs(`display("${sanitizeForJs(userInput)}")`);
 * ```
 */
export const sanitizeForJs: (input: string) => string = _nativeBinding.sanitizeForJs;

// ── NativeWindow ────────────────────────────────────────────────────

/**
 * A native OS window with an embedded webview.
 *
 * Automatically initializes the native subsystem and starts pumping
 * events on first construction. Stops the pump when all windows close.
 *
 * All methods throw `"Window is closed"` if called after `close()`.
 *
 * @example
 * ```ts
 * import { NativeWindow } from "@nativewindow/webview";
 *
 * const win = new NativeWindow({ title: "Hello", width: 800, height: 600 });
 * win.loadUrl("https://example.com");
 * win.onClose(() => console.log("Window closed"));
 * ```
 */
export const NativeWindow = _nativeBinding.NativeWindow;

/**
 * Instance type for {@link NativeWindow}.
 */
export type NativeWindow = InstanceType<typeof NativeWindow>;
