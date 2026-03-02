import { NativeWindow, type WindowOptions } from "@nativewindow/webview";

// ── Types ──────────────────────────────────────────────────────────

// ── Security notes ────────────────────────────────────────────────
//
// Origin restriction on incoming IPC messages:
//
// `NativeWindow.onMessage(callback)` now provides `(message, sourceUrl)`.
// When `trustedOrigins` is configured, incoming messages from non-matching
// origins are silently dropped. This applies to both the typed channel
// envelope and the raw IPC bridge. The `sourceUrl` is provided by the
// native platform layer:
//   - macOS: extracted from WKScriptMessage.frameInfo.request.URL
//   - Windows: extracted from ICoreWebView2WebMessageReceivedEventArgs.Source
//
// Empty source URLs (e.g. about:blank, data: URIs) will not match any
// trusted origin and are rejected when trustedOrigins is set.
// ──────────────────────────────────────────────────────────────────

/** User-defined map of event name -> payload type. */
export type EventMap = Record<string, unknown>;

/**
 * A schema that can validate data at runtime via `safeParse()`.
 * Compatible with Zod v4, Valibot v1, and any library exposing
 * a `safeParse` method returning `{ success: boolean; data?: T }`.
 *
 * @example
 * ```ts
 * import { z } from "zod";
 * const schema: SchemaLike = z.string(); // compatible
 * ```
 */
export interface SchemaLike {
  safeParse(data: unknown): { success: true; data: unknown } | { success: false; error?: unknown };
}

/**
 * Map of event names to schemas.
 * TypeScript types are derived from the schemas via {@link InferSchemaMap}.
 *
 * @example
 * ```ts
 * import { z } from "zod";
 * const schemas = {
 *   ping: z.string(),
 *   pong: z.number(),
 *   data: z.object({ x: z.number(), y: z.number() }),
 * } satisfies SchemaMap;
 * ```
 */
export type SchemaMap = Record<string, SchemaLike>;

/**
 * Infer the output type from a single schema.
 * Supports Zod v4 (`_zod.output`), Valibot v1 (`_types.output`),
 * and the Standard Schema spec (`~standard.types.output`).
 * Falls back to `unknown` for unrecognized schema shapes.
 *
 * @example
 * ```ts
 * import { z } from "zod";
 * type S = InferOutput<typeof z.string()>; // string
 * ```
 */
export type InferOutput<S> = S extends { _zod: { output: infer T } }
  ? T
  : S extends { _types?: { output: infer T } }
    ? T
    : S extends { "~standard": { types?: { output: infer T } } }
      ? T
      : unknown;

/**
 * Derive an {@link EventMap} from a {@link SchemaMap}.
 * Each key maps to the inferred output type of its schema.
 *
 * @example
 * ```ts
 * const schemas = { ping: z.string(), pong: z.number() };
 * type Events = InferSchemaMap<typeof schemas>;
 * // ^? { ping: string; pong: number }
 * ```
 */
export type InferSchemaMap<S extends SchemaMap> = {
  [K in keyof S & string]: InferOutput<S[K]>;
};

/**
 * Called when a payload fails runtime validation.
 *
 * @example
 * ```ts
 * const onError: ValidationErrorHandler = (type, payload) => {
 *   console.warn(`Invalid payload for "${type}":`, payload);
 * };
 * ```
 */
export type ValidationErrorHandler = (type: string, payload: unknown) => void;

/** Wire format for typed messages. */
interface Envelope {
  $ch: string;
  p: unknown;
}

/**
 * Argument tuple for {@link TypedChannel.send}.
 * When the payload type is `void` or `never`, the payload argument is
 * optional — callers can write `send("ping")` instead of `send("ping", undefined)`.
 *
 * @internal
 */
export type SendArgs<T extends EventMap, K extends keyof T & string> = [T[K]] extends [void | never]
  ? [type: K] | [type: K, payload: T[K]]
  : [type: K, payload: T[K]];

/** Typed channel interface (shared shape for both host and webview sides). */
export interface TypedChannel<T extends EventMap> {
  /** Send a typed message. */
  send<K extends keyof T & string>(...args: SendArgs<T, K>): void;
  /** Register a handler for a typed message. */
  on<K extends keyof T & string>(type: K, handler: (payload: T[K]) => void): void;
  /** Remove a handler for a typed message. */
  off<K extends keyof T & string>(type: K, handler: (payload: T[K]) => void): void;
}

/** Host-side channel wrapping a NativeWindow. */
export interface NativeWindowChannel<T extends EventMap> extends TypedChannel<T> {
  /** The underlying NativeWindow instance. */
  readonly window: NativeWindow;
}

/**
 * Options for {@link createChannel}.
 * The `schemas` field is required — it provides both TypeScript types
 * and runtime validation for each event.
 *
 * @example
 * ```ts
 * import { z } from "zod";
 * const ch = createChannel(win, {
 *   schemas: { ping: z.string(), pong: z.number() },
 * });
 * ch.send("ping", "hello"); // typed from schema
 * ```
 */
export interface ChannelOptions<S extends SchemaMap> {
  /** Schemas for each event. Provides both TypeScript types and runtime validation. */
  schemas: S;
  /** Inject the client script into the webview automatically. Default: true */
  injectClient?: boolean;
  /**
   * Called when an incoming payload fails schema validation.
   * If not provided, failed payloads are silently dropped.
   */
  onValidationError?: ValidationErrorHandler;
  /**
   * Restrict client script injection to pages from these origins.
   * Each entry should be an origin string (e.g. `"https://example.com"`).
   * When set and `injectClient` is true, the client script is only
   * re-injected on page load if the page URL's origin matches.
   * When set, the initial injection is deferred until the first
   * trusted page load to prevent exposing the IPC bridge to
   * untrusted origins.
   *
   * Origins should not include a trailing slash. The `about:blank` and
   * `data:` URLs have an origin of `"null"` — they will not match unless
   * `"null"` is explicitly listed.
   *
   * @security Use this to prevent the IPC bridge from being available on
   * untrusted pages after navigation.
   *
   * @example
   * ```ts
   * createChannel(win, {
   *   schemas: { ping: z.string() },
   *   trustedOrigins: ["https://myapp.com", "https://cdn.myapp.com"],
   * });
   * ```
   */
  trustedOrigins?: string[];
  /**
   * Maximum allowed size (in characters) for incoming IPC messages.
   * Messages exceeding this limit are silently dropped.
   * Default: 1 MB (1_048_576 characters).
   *
   * @security Prevents memory exhaustion from oversized payloads.
   */
  maxMessageSize?: number;
  /**
   * Maximum number of incoming messages allowed per second.
   * When the limit is exceeded, additional messages are silently dropped
   * until the window slides forward. Default: unlimited.
   *
   * @security Prevents flooding from malicious webview content.
   */
  rateLimit?: number;
  /**
   * Maximum number of listeners allowed per event type.
   * Calls to `on()` that would exceed this limit are silently ignored.
   * Default: unlimited.
   *
   * @security Prevents unbounded memory growth from listener leaks.
   */
  maxListenersPerEvent?: number;
  /**
   * Channel namespace identifier. When set, all `$ch` values in the IPC
   * envelope are prefixed with `channelId:`, preventing malicious scripts
   * from sending messages that match known event types.
   *
   * - Pass a string to use a fixed namespace.
   * - Pass `true` to auto-generate a random 8-character nonce.
   * - Leave undefined to use the original (unprefixed) envelope format.
   *
   * The injected client script (via `getClientScript`) will include the
   * same prefix, so host and client stay in sync automatically.
   *
   * @security Prevents channel name collision / namespace squatting
   * from untrusted scripts in the webview.
   */
  channelId?: string | true;
}

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Default maximum IPC message size (1 MB).
 * Messages exceeding this limit are silently dropped to prevent
 * memory exhaustion from oversized payloads.
 * @internal
 */
const MAX_MESSAGE_SIZE = 1_048_576;

/**
 * Validate a payload against a schema using `safeParse()`.
 * Returns the parsed data on success so that schema transforms are honored.
 * @internal
 */
function validatePayload(
  schema: SchemaLike,
  data: unknown,
): { success: true; data: unknown } | { success: false } {
  const result = schema.safeParse(data);
  return result.success ? { success: true, data: result.data } : { success: false };
}

function isEnvelope(data: unknown): data is Envelope {
  return (
    typeof data === "object" &&
    data !== null &&
    "$ch" in data &&
    typeof (data as Envelope).$ch === "string"
  );
}

function encode(type: string, payload: unknown): string {
  return JSON.stringify({ $ch: type, p: payload });
}

/** @internal Keys that could pollute prototypes if merged into target objects. */
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function decode(raw: string, maxSize: number = MAX_MESSAGE_SIZE): Envelope | null {
  if (raw.length > maxSize) return null;
  try {
    // Reviver strips dangerous keys at every nesting level (defense-in-depth).
    const parsed: unknown = JSON.parse(raw, (key, value) =>
      DANGEROUS_KEYS.has(key) ? undefined : value,
    );
    return isEnvelope(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Normalize an origin string using the WHATWG URL Standard.
 * Lowercases scheme/host, strips default ports (80/443), and
 * strips userinfo — matching the Rust `url` crate behavior.
 * Returns `null` for malformed URLs or opaque origins.
 * @internal
 */
function normalizeOrigin(origin: string): string | null {
  try {
    const o = new URL(origin).origin;
    return o === "null" ? null : o;
  } catch {
    return null;
  }
}

/**
 * Check if a URL's origin matches any of the trusted origins.
 * The `trustedOrigins` array must already be normalized via
 * {@link normalizeOrigin} for correct comparison.
 * @internal
 */
function isOriginTrusted(url: string, trustedOrigins: string[]): boolean {
  try {
    const parsed = new URL(url);
    return trustedOrigins.includes(parsed.origin);
  } catch {
    // Malformed URL — treat as untrusted
    return false;
  }
}

// ── Client script ──────────────────────────────────────────────────

/**
 * Returns the webview-side channel client as a self-contained JS string.
 * This is the same logic as `client.ts`, minified for injection.
 * Can also be embedded in a `<script>` tag manually.
 *
 * When `options.channelId` is provided, the injected script prefixes all
 * `$ch` values with the channel ID, matching the host-side behavior.
 *
 * **Note:** The injected client does not support payload validation.
 * For client-side validation, use the bundled {@link createChannelClient}
 * import from `native-window-ipc/client` with the `schemas` option.
 *
 * @example
 * ```ts
 * // Without namespace (default)
 * const script = getClientScript();
 *
 * // With namespace
 * const script = getClientScript({ channelId: "abc123" });
 * ```
 */
export function getClientScript(options?: { channelId?: string }): string {
  const prefix = options?.channelId ?? "";
  // JSON.stringify the prefix to produce a safe JS string literal (handles quotes, backslashes)
  const prefixLiteral = JSON.stringify(prefix);
  return `(function(){
var _slice=Array.prototype.slice;
var _filter=Array.prototype.filter;
var _push=Array.prototype.push;
var _indexOf=Array.prototype.indexOf;
var _splice=Array.prototype.splice;
var _pfx=${prefixLiteral};
var _l=Object.create(null);
var _el=[];
function _e(t,p){return JSON.stringify({$ch:_pfx?_pfx+":"+t:t,p:p})}
function _d(r){if(r.length>1048576)return null;var _dk={__proto__:1,constructor:1,prototype:1};try{var o=JSON.parse(r,function(k,v){return _dk[k]?void 0:v});if(o&&typeof o.$ch==="string")return o}catch(e){}return null}
function _uch(ch){if(!_pfx)return ch;if(ch.indexOf(_pfx+":")===0)return ch.slice(_pfx.length+1);return null}
var ch={
send:function(t,p){window.ipc.postMessage(_e(t,p))},
on:function(t,h){if(!_l[t])_l[t]=[];_push.call(_l[t],h)},
off:function(t,h){if(!_l[t])return;_l[t]=_filter.call(_l[t],function(f){return f!==h})}
};
var _orig=window.__native_message__;
try{Object.defineProperty(window,'__native_message__',{value:function(msg){
var env=_d(msg);
if(env){var key=_uch(env.$ch);if(key!==null&&_l[key]){var fns=_slice.call(_l[key]);for(var i=0;i<fns.length;i++){try{fns[i](env.p)}catch(e){}}}
else{for(var j=0;j<_el.length;j++){try{_el[j](msg)}catch(e){}}if(_orig){_orig(msg)}}}
else{for(var j=0;j<_el.length;j++){try{_el[j](msg)}catch(e){}}if(_orig){_orig(msg)}}
},writable:false,configurable:false})}catch(e){console.error('[native-window] Failed to define __native_message__:',e)}
try{Object.defineProperty(window,'__native_message_listeners__',{value:Object.freeze({add:function(fn){if(typeof fn==='function')_push.call(_el,fn)},remove:function(fn){var i=_indexOf.call(_el,fn);if(i!==-1)_splice.call(_el,i,1)}}),writable:false,configurable:false})}catch(e){console.error('[native-window] Failed to define __native_message_listeners__:',e)}
try{Object.defineProperty(window,'__channel__',{value:Object.freeze(ch),writable:false,configurable:false})}catch(e){console.error('[native-window] Failed to define __channel__:',e)}
})();`;
}

// ── createChannel ──────────────────────────────────────────────────

/**
 * Wrap an existing NativeWindow with a typed message channel.
 *
 * Schemas are required — they provide both TypeScript types and runtime
 * validation for each event. Compatible with Zod v4, Valibot v1, and
 * any schema library implementing the `safeParse()` interface.
 *
 * @security **Origin restriction:** When `trustedOrigins` is configured,
 * both client script injection and incoming IPC messages are restricted to
 * pages whose URL origin matches the whitelist. The native `onMessage`
 * callback now includes the source page URL, enabling the channel to reject
 * messages from untrusted origins. Empty source URLs (e.g. `about:blank`,
 * `data:` URIs) are treated as untrusted when `trustedOrigins` is set.
 *
 * @example
 * ```ts
 * import { z } from "zod";
 * import { createChannel } from "native-window-ipc";
 *
 * const ch = createChannel(win, {
 *   schemas: { ping: z.string(), pong: z.number() },
 * });
 * ch.send("ping", "hello");       // typed from schema
 * ch.on("pong", (n) => {});       // n: number
 * ```
 */
export function createChannel<S extends SchemaMap>(
  win: NativeWindow,
  options: ChannelOptions<S>,
): NativeWindowChannel<InferSchemaMap<S>> {
  const {
    schemas,
    injectClient = true,
    onValidationError,
    trustedOrigins,
    maxMessageSize,
    rateLimit,
    maxListenersPerEvent,
    channelId: channelIdOpt,
  } = options;

  // Resolve channelId: true → cryptographically random nonce, string → as-is, undefined → ""
  const channelId =
    channelIdOpt === true
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
      : (channelIdOpt ?? "");

  // Normalize trusted origins using WHATWG URL Standard so that
  // "HTTPS://Example.Com:443" is stored as "https://example.com".
  // This mirrors the Rust-side normalization via the `url` crate.
  const normalizedOrigins = trustedOrigins
    ?.map(normalizeOrigin)
    .filter((o): o is string => o !== null);

  // Channel prefix helpers
  const prefixCh = (type: string): string => (channelId ? `${channelId}:${type}` : type);
  const unprefixCh = (ch: string): string | null => {
    if (!channelId) return ch;
    const pfx = `${channelId}:`;
    return ch.startsWith(pfx) ? ch.slice(pfx.length) : null;
  };

  const listeners = new Map<string, Set<(payload: any) => void>>();

  // Token-bucket rate limiter state (O(1) per message)
  let _bucketTokens = rateLimit ?? 0;
  let _bucketLastRefill = Date.now();

  // Wire up incoming messages from the webview
  win.onMessage((raw: string, sourceUrl: string) => {
    // Rate limiting — token bucket, refills to `rateLimit` tokens per second
    if (rateLimit !== undefined && rateLimit > 0) {
      const now = Date.now();
      const elapsed = now - _bucketLastRefill;
      if (elapsed >= 1000) {
        _bucketTokens = rateLimit;
        _bucketLastRefill = now;
      }
      if (_bucketTokens <= 0) return;
      _bucketTokens--;
    }

    const env = decode(raw, maxMessageSize);
    if (!env) return;

    // Unprefix the channel name; drop messages with wrong/missing prefix
    const eventType = unprefixCh(env.$ch);
    if (eventType === null) return;

    // Reject messages from untrusted origins when trustedOrigins is set
    if (normalizedOrigins && normalizedOrigins.length > 0) {
      if (!isOriginTrusted(sourceUrl, normalizedOrigins)) return;
    }

    const set = listeners.get(eventType);
    if (!set) return;

    // Drop messages whose event type is not a known schema key (strict allowlist)
    if (!(eventType in schemas)) return;

    // Validate payload against the schema for this channel
    const schema = schemas[eventType];
    let validatedPayload: unknown = env.p;
    if (schema) {
      const result = validatePayload(schema, env.p);
      if (!result.success) {
        onValidationError?.(eventType, env.p);
        return;
      }
      validatedPayload = result.data;
    }

    for (const fn of set) {
      try {
        fn(validatedPayload);
      } catch {}
    }
  });

  // Inject client script into webview
  if (injectClient) {
    // Only inject immediately if trustedOrigins is not set;
    // when trustedOrigins is set, defer injection to the first
    // trusted page load to avoid exposing the IPC bridge to
    // untrusted origins before the first navigation completes.
    if (!normalizedOrigins || normalizedOrigins.length === 0) {
      win.unsafe.evaluateJs(getClientScript({ channelId: channelId || undefined }));
    }

    // Re-inject on every page load so the client survives navigation
    win.onPageLoad((event: "started" | "finished", url: string) => {
      if (event !== "finished") return;

      // If trustedOrigins is set, only inject for matching origins
      if (normalizedOrigins && normalizedOrigins.length > 0) {
        if (!isOriginTrusted(url, normalizedOrigins)) return;
      }

      win.unsafe.evaluateJs(getClientScript({ channelId: channelId || undefined }));
    });
  }

  return {
    window: win,

    send<K extends keyof InferSchemaMap<S> & string>(
      ...args: SendArgs<InferSchemaMap<S>, K>
    ): void {
      const [type, payload] = args;
      // Note: Outgoing payloads are not validated at runtime — only TypeScript
      // types provide compile-time safety. For defense-in-depth, consider
      // validating outgoing data against schemas before sending.
      win.postMessage(encode(prefixCh(type), payload));
    },

    on<K extends keyof InferSchemaMap<S> & string>(
      type: K,
      handler: (payload: InferSchemaMap<S>[K]) => void,
    ): void {
      // Runtime schema key validation — reject unrecognized event types
      if (!(type in schemas)) return;
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      if (maxListenersPerEvent !== undefined && set.size >= maxListenersPerEvent) return;
      set.add(handler as (payload: any) => void);
    },

    off<K extends keyof InferSchemaMap<S> & string>(
      type: K,
      handler: (payload: InferSchemaMap<S>[K]) => void,
    ): void {
      const set = listeners.get(type);
      if (set) set.delete(handler as (payload: any) => void);
    },
  };
}

// ── createWindow (convenience) ─────────────────────────────────────

/**
 * Create a new NativeWindow and immediately wrap it with a typed channel.
 *
 * @example
 * ```ts
 * import { z } from "zod";
 * import { createWindow } from "native-window-ipc";
 *
 * const ch = createWindow(
 *   { title: "My App" },
 *   { schemas: { counter: z.number(), title: z.string() } },
 * );
 * ch.send("counter", 42); // typed from schema
 * ch.window.loadHtml("<html>...</html>");
 * ```
 */
export function createWindow<S extends SchemaMap>(
  windowOptions: WindowOptions | undefined,
  channelOptions: ChannelOptions<S>,
): NativeWindowChannel<InferSchemaMap<S>> {
  const win = new NativeWindow(windowOptions);
  return createChannel(win, channelOptions);
}
