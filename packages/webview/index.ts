// ── Native Addon Loader ─────────────────────────────────────────────
// Resolves the correct platform-specific .node binary at runtime.
// Tries local .node files first (development), then per-platform npm packages (production).

import { createRequire } from "node:module";

const _require = createRequire(import.meta.url);

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

const _platformKey = `${process.platform}-${process.arch}`;
const _entry = _platforms[_platformKey];

if (!_entry) {
  throw new Error(`Unsupported platform: ${_platformKey}`);
}

function _tryRequire(id: string): NativeBindings | null {
  try {
    return _require(id) as NativeBindings;
  } catch {
    return null;
  }
}

/** @internal Shape of the raw native addon exports. */
interface NativeBindings {
  NativeWindow: NativeWindowConstructor;
  init: () => void;
  pumpEvents: () => void;
  checkRuntime: () => RuntimeInfo;
  ensureRuntime: () => RuntimeInfo;
  loadHtmlOrigin: () => string;
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
  getCookies(url?: string): void;
  onCookies(callback: (cookies: string) => void): void;
  clearCookies(host?: string): void;
  openDevtools(): void;
  closeDevtools(): void;
  isDevtoolsOpen(): boolean;
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

const {
  NativeWindow: _NativeWindow,
  init,
  pumpEvents,
  checkRuntime,
  ensureRuntime,
  loadHtmlOrigin,
} = _nativeBinding;

export { checkRuntime, ensureRuntime, loadHtmlOrigin };

// ── Types ───────────────────────────────────────────────────────────

/** Information about the native webview runtime. */
export interface RuntimeInfo {
  /** Whether the webview runtime is available. */
  available: boolean;
  /** The version string of the runtime, if detected. */
  version?: string;
  /** The current platform: "macos", "windows", "linux", or "unsupported". */
  platform: "macos" | "windows" | "linux" | "unsupported";
}

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

// ---------------------------------------------------------------------------
// Auto-init / auto-pump state
// ---------------------------------------------------------------------------

let _pump: ReturnType<typeof setInterval> | null = null;
let _windowCount = 0;

function ensureInit() {
  if (_pump) return;
  init();
  _pump = setInterval(() => {
    try {
      pumpEvents();
    } catch (e) {
      console.error("[native-window] pumpEvents() error:", e);
    }
  }, 16);
}

function stopPump() {
  if (_pump) {
    clearInterval(_pump);
    _pump = null;
  }
}

// ---------------------------------------------------------------------------
// Unsafe namespace
// ---------------------------------------------------------------------------

/**
 * Operations that execute arbitrary code in the webview context.
 * Grouped under {@link NativeWindow.unsafe} to signal injection risk.
 *
 * @security Never pass unsanitized user input to these methods.
 * Use {@link sanitizeForJs} to escape strings before embedding them in
 * script code.
 */
export interface UnsafeNamespace {
  /**
   * Evaluate arbitrary JavaScript in the webview context.
   * Fire-and-forget — there is no return value.
   * Use `postMessage`/`onMessage` to send results back.
   *
   * @security **Injection risk.** Never pass unsanitized user input directly.
   * Use {@link sanitizeForJs} to escape strings before embedding them in
   * script code.
   */
  evaluateJs(script: string): void;
}

// ---------------------------------------------------------------------------
// Devtools namespace
// ---------------------------------------------------------------------------

/**
 * Control the browser devtools panel for this window's webview.
 * Grouped under {@link NativeWindow.devtools} for discoverability.
 *
 * Requires `devtools: true` in {@link WindowOptions} at window creation.
 *
 * @example
 * ```ts
 * const win = new NativeWindow({ devtools: true });
 * win.devtools.open();
 * console.log(win.devtools.isOpen()); // true
 * win.devtools.close();
 * ```
 */
export interface DevtoolsNamespace {
  /** Open the browser devtools panel. */
  open(): void;
  /** Close the browser devtools panel. */
  close(): void;
  /** Check whether the devtools panel is currently open. */
  isOpen(): boolean;
}

// ---------------------------------------------------------------------------
// Cookie types
// ---------------------------------------------------------------------------

/**
 * Information about a cookie from the native cookie store.
 * Includes `HttpOnly` cookies that are invisible to `document.cookie`.
 *
 * @example
 * ```ts
 * win.onCookies((cookies) => {
 *   for (const c of cookies) {
 *     console.log(c.name, c.value, c.httpOnly);
 *   }
 * });
 * win.getCookies("https://example.com");
 * ```
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
  /** SameSite policy: "none", "lax", or "strict". */
  sameSite: string;
  /** Expiry as Unix timestamp (seconds). -1 for session cookies. */
  expires: number;
}

// ---------------------------------------------------------------------------
// NativeWindow wrapper – auto-init, auto-pump, auto-stop
// ---------------------------------------------------------------------------

/**
 * A native OS window with an embedded webview.
 *
 * Automatically initializes the native subsystem and starts pumping
 * events on first construction. Stops the pump when all windows close.
 */
export class NativeWindow {
  /** @internal */
  private _native: InstanceType<typeof _NativeWindow>;
  /** @internal */
  private _closed = false;
  /** @internal */
  private _unsafe?: UnsafeNamespace;
  /** @internal */
  private _devtools?: DevtoolsNamespace;

  constructor(options?: WindowOptions) {
    ensureInit();
    _windowCount++;
    this._native = new _NativeWindow(options);

    // Register a default close handler to track window count.
    this._native.onClose(() => this._handleClose());
  }

  /** @internal */
  private _handleClose() {
    if (this._closed) return;
    this._closed = true;
    _windowCount--;
    this._userCloseCallback?.();
    if (_windowCount <= 0) {
      _windowCount = 0;
      setTimeout(() => stopPump(), 200);
    }
  }

  /**
   * Throws if the window has been closed.
   * @internal
   */
  private _ensureOpen(): void {
    if (this._closed) {
      throw new Error("Window is closed");
    }
  }

  // ---- onClose with user callback support ----

  private _userCloseCallback?: () => void;

  /**
   * Register a handler for the window close event.
   * The pump is automatically stopped when all windows are closed.
   *
   * Calling this multiple times replaces the previous handler.
   */
  onClose(callback: () => void): void {
    if (this._userCloseCallback) {
      console.warn(
        "NativeWindow: onClose() called multiple times. The previous handler will be replaced.",
      );
    }
    this._userCloseCallback = callback;
  }

  // ---- Getters ----

  /** Unique window ID */
  get id(): number {
    return this._native.id;
  }

  // ---- Content loading ----

  loadUrl(url: string): void {
    this._ensureOpen();
    this._native.loadUrl(url);
  }

  /**
   * Load raw HTML content into the webview.
   *
   * @security **Injection risk.** Never interpolate unsanitized user input
   * into HTML strings. Use a dedicated sanitization library such as
   * [DOMPurify](https://github.com/cure53/DOMPurify) or
   * [sanitize-html](https://github.com/apostrophecms/sanitize-html) to
   * sanitize untrusted content before embedding it.
   */
  loadHtml(html: string): void {
    this._ensureOpen();
    this._native.loadHtml(html);
  }

  postMessage(message: string): void {
    this._ensureOpen();
    this._native.postMessage(message);
  }

  // ---- Unsafe operations ----

  /**
   * Namespace for operations that require extra care to avoid injection risks.
   * Methods under `unsafe` execute arbitrary code in the webview context.
   *
   * @security Never pass unsanitized user input to these methods.
   * Use {@link sanitizeForJs} to escape strings before embedding them in
   * script code.
   */
  get unsafe(): UnsafeNamespace {
    this._ensureOpen();
    if (!this._unsafe) {
      this._unsafe = {
        evaluateJs: (script: string): void => {
          this._ensureOpen();
          this._native.evaluateJs(script);
        },
      };
    }
    return this._unsafe;
  }

  // ---- Devtools ----

  /**
   * Namespace for controlling the browser devtools panel.
   * Requires `devtools: true` in {@link WindowOptions} at window creation.
   *
   * @example
   * ```ts
   * const win = new NativeWindow({ devtools: true });
   * win.devtools.open();
   * console.log(win.devtools.isOpen()); // true
   * win.devtools.close();
   * ```
   */
  get devtools(): DevtoolsNamespace {
    this._ensureOpen();
    if (!this._devtools) {
      this._devtools = {
        open: (): void => {
          this._ensureOpen();
          this._native.openDevtools();
        },
        close: (): void => {
          this._ensureOpen();
          this._native.closeDevtools();
        },
        isOpen: (): boolean => {
          this._ensureOpen();
          return this._native.isDevtoolsOpen();
        },
      };
    }
    return this._devtools;
  }

  // ---- Window control ----

  setTitle(title: string): void {
    this._ensureOpen();
    this._native.setTitle(title);
  }

  setSize(width: number, height: number): void {
    this._ensureOpen();
    this._native.setSize(width, height);
  }

  setMinSize(width: number, height: number): void {
    this._ensureOpen();
    this._native.setMinSize(width, height);
  }

  setMaxSize(width: number, height: number): void {
    this._ensureOpen();
    this._native.setMaxSize(width, height);
  }

  setPosition(x: number, y: number): void {
    this._ensureOpen();
    this._native.setPosition(x, y);
  }

  setResizable(resizable: boolean): void {
    this._ensureOpen();
    this._native.setResizable(resizable);
  }

  setDecorations(decorations: boolean): void {
    this._ensureOpen();
    this._native.setDecorations(decorations);
  }

  setAlwaysOnTop(alwaysOnTop: boolean): void {
    this._ensureOpen();
    this._native.setAlwaysOnTop(alwaysOnTop);
  }

  /**
   * Set the window icon from a PNG or ICO file path.
   * On macOS this is silently ignored (macOS doesn't support per-window icons).
   * Relative paths resolve from the working directory.
   */
  setIcon(path: string): void {
    this._ensureOpen();
    this._native.setIcon(path);
  }

  // ---- Window state ----

  show(): void {
    this._ensureOpen();
    this._native.show();
  }

  hide(): void {
    this._ensureOpen();
    this._native.hide();
  }

  close(): void {
    this._ensureOpen();
    this._native.close();
  }

  focus(): void {
    this._ensureOpen();
    this._native.focus();
  }

  maximize(): void {
    this._ensureOpen();
    this._native.maximize();
  }

  minimize(): void {
    this._ensureOpen();
    this._native.minimize();
  }

  unmaximize(): void {
    this._ensureOpen();
    this._native.unmaximize();
  }

  reload(): void {
    this._ensureOpen();
    this._native.reload();
  }

  // ---- Event handlers ----

  /**
   * Register a handler for messages from the webview.
   *
   * @security **No origin filtering.** The raw `onMessage` API does not
   * enforce origin restrictions. If your webview navigates to untrusted
   * URLs, validate the `sourceUrl` parameter before processing messages.
   * For automatic origin filtering, use `createChannel()` with the
   * `trustedOrigins` option from `native-window-ipc`.
   *
   * @security **No rate limiting.** Messages from the webview are delivered
   * without throttling. A malicious page can flood the host with messages.
   * Consider implementing application-level rate limiting if loading
   * untrusted content.
   */
  onMessage(callback: (message: string, sourceUrl: string) => void): void {
    this._ensureOpen();
    this._native.onMessage(callback);
  }

  onResize(callback: (width: number, height: number) => void): void {
    this._ensureOpen();
    this._native.onResize(callback);
  }

  onMove(callback: (x: number, y: number) => void): void {
    this._ensureOpen();
    this._native.onMove(callback);
  }

  onFocus(callback: () => void): void {
    this._ensureOpen();
    this._native.onFocus(callback);
  }

  onBlur(callback: () => void): void {
    this._ensureOpen();
    this._native.onBlur(callback);
  }

  onPageLoad(callback: (event: "started" | "finished", url: string) => void): void {
    this._ensureOpen();
    this._native.onPageLoad(callback);
  }

  onTitleChanged(callback: (title: string) => void): void {
    this._ensureOpen();
    this._native.onTitleChanged(callback);
  }

  onReload(callback: () => void): void {
    this._ensureOpen();
    this._native.onReload(callback);
  }

  /**
   * Register a handler for blocked navigation events.
   * Fired when a navigation is blocked by the {@link WindowOptions.allowedHosts}
   * restriction. Receives the URL that was blocked.
   *
   * @example
   * ```ts
   * win.onNavigationBlocked((url) => {
   *   console.log("Blocked navigation to:", url);
   * });
   * ```
   */
  onNavigationBlocked(callback: (url: string) => void): void {
    this._ensureOpen();
    this._native.onNavigationBlocked(callback);
  }

  // ---- Cookie access ----

  /**
   * Validate and parse a raw cookies JSON array from the native layer.
   * Returns a cleaned {@link CookieInfo} array or `null` if the payload
   * is malformed.
   *
   * @internal
   */
  private _validateCookies(raw: string): CookieInfo[] | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!Array.isArray(parsed)) return null;

    const cookies: CookieInfo[] = [];
    for (const item of parsed) {
      if (typeof item !== "object" || item === null) continue;
      const obj = item as Record<string, unknown>;
      if (typeof obj.name !== "string" || typeof obj.value !== "string") {
        continue;
      }
      if (typeof obj.domain !== "string" || typeof obj.path !== "string") {
        continue;
      }
      if (typeof obj.httpOnly !== "boolean" || typeof obj.secure !== "boolean") {
        continue;
      }
      if (typeof obj.sameSite !== "string" || typeof obj.expires !== "number") {
        continue;
      }
      cookies.push({
        name: obj.name as string,
        value: obj.value as string,
        domain: obj.domain as string,
        path: obj.path as string,
        httpOnly: obj.httpOnly as boolean,
        secure: obj.secure as boolean,
        sameSite: obj.sameSite as string,
        expires: obj.expires as number,
      });
    }
    return cookies;
  }

  /**
   * Query cookies from the native cookie store.
   *
   * Returns a Promise that resolves with validated {@link CookieInfo} objects,
   * including `HttpOnly` cookies that are invisible to `document.cookie`.
   *
   * - **macOS**: Uses `WKHTTPCookieStore.getAllCookies` with client-side
   *   URL filtering (domain + path match).
   * - **Windows**: Uses `ICoreWebView2CookieManager.GetCookies` which
   *   filters by URI natively.
   *
   * @param url  If provided, only cookies matching this URL are returned.
   *             If omitted, all cookies in the webview's cookie store are returned.
   *
   * @example
   * ```ts
   * const cookies = await win.getCookies("https://example.com");
   * const session = cookies.find((c) => c.name === "session_id");
   * if (session) console.log("Session:", session.value, "HttpOnly:", session.httpOnly);
   * ```
   */
  getCookies(url?: string): Promise<CookieInfo[]> {
    this._ensureOpen();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("getCookies() timed out after 10 seconds"));
      }, 10_000);
      this._native.onCookies((raw: string) => {
        clearTimeout(timeout);
        const validated = this._validateCookies(raw);
        if (validated) {
          resolve(validated);
        } else {
          reject(new Error("Failed to parse cookie response"));
        }
      });
      this._native.getCookies(url);
    });
  }

  /**
   * Clear cookies from the native cookie store.
   *
   * - If `host` is provided, only cookies whose domain matches that host
   *   are deleted (e.g. `"example.com"` deletes `.example.com` cookies).
   * - If omitted, all cookies in the webview's cookie store are cleared.
   *
   * @example
   * ```ts
   * // Clear all cookies
   * win.clearCookies();
   *
   * // Clear cookies for a specific host
   * win.clearCookies("example.com");
   * ```
   */
  clearCookies(host?: string): void {
    this._ensureOpen();
    this._native.clearCookies(host);
  }
}
// ---------------------------------------------------------------------------
// Security helpers
// ---------------------------------------------------------------------------

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
 * import { NativeWindow, sanitizeForJs } from "native-window";
 *
 * const userInput = 'He said "hello"\n<script>alert(1)</script>';
 * win.unsafe.evaluateJs(`display("${sanitizeForJs(userInput)}")`);
 * ```
 */
export function sanitizeForJs(input: string): string {
  return JSON.stringify(input)
    .slice(1, -1)
    .replace(/<\/script>/gi, "<\\/script>")
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\${");
}
