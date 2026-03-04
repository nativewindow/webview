/**
 * Webview-side typed channel client.
 *
 * Can be used two ways:
 *
 * 1. **Imported** in a bundled webview app (shares node_modules):
 *    ```ts
 *    import { createChannelClient } from "native-window-ipc/client";
 *    const channel = createChannelClient({
 *      schemas: {
 *        host: { title: z.string() },
 *        client: { counter: z.number() },
 *      },
 *    });
 *    channel.send("counter", 42);       // only client events
 *    channel.on("title", (t) => {});    // only host events
 *    ```
 *
 * 2. **Auto-injected** by the host-side `createChannel()`.
 *    The client is exposed as `window.__channel__` with the same API (untyped at runtime).
 */

import type {
  TypedChannel,
  SendArgs,
  ValidationErrorHandler,
  SchemaMap,
  SchemaLike,
  InferSchemaMap,
  EventMap,
} from "./index.ts";

declare global {
  interface Window {
    __channel__?: TypedChannel<any, any>;
    __native_message__?: (msg: string) => void;
    __native_message_listeners__?: {
      add(fn: (msg: string) => void): void;
      remove(fn: (msg: string) => void): void;
    };
    ipc: { postMessage(msg: string): void };
  }
}

/** Wire format for typed messages. */
interface Envelope {
  $ch: string;
  p: unknown;
}

/**
 * Default maximum IPC message size (1 MB).
 * @internal
 */
const MAX_MESSAGE_SIZE = 1_048_576;

function encode(type: string, payload: unknown): string {
  return JSON.stringify({ $ch: type, p: payload });
}

/** @internal Keys that could pollute prototypes if merged into target objects. */
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function decode(raw: string): Envelope | null {
  if (raw.length > MAX_MESSAGE_SIZE) return null;
  try {
    // Reviver strips dangerous keys at every nesting level (defense-in-depth).
    const parsed: unknown = JSON.parse(raw, (key, value) =>
      DANGEROUS_KEYS.has(key) ? undefined : value,
    );
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "$ch" in parsed &&
      typeof (parsed as Envelope).$ch === "string"
    ) {
      return parsed as Envelope;
    }
  } catch {
    // not a valid envelope
  }
  return null;
}

/**
 * Options for {@link createChannelClient}.
 * The `schemas` field is required — it uses directional groups matching
 * the host-side `createChannel` options.
 *
 * @example
 * ```ts
 * import { z } from "zod";
 * const ch = createChannelClient({
 *   schemas: {
 *     host: { "update-title": z.string() },
 *     client: { "user-click": z.object({ x: z.number(), y: z.number() }) },
 *   },
 * });
 * ```
 */
export interface ChannelClientOptions<H extends SchemaMap, C extends SchemaMap> {
  /**
   * Directional schemas for the channel.
   * - `host`: events the host sends to the client (validated on receive).
   * - `client`: events the client sends to the host (type-checked on send).
   */
  schemas: { host: H; client: C };
  /**
   * Called when an incoming payload fails schema validation.
   * If not provided, failed payloads are silently dropped.
   */
  onValidationError?: ValidationErrorHandler;
}

// ── Helpers ────────────────────────────────────────────────────────

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

/**
 * Create a typed channel client for use inside the webview.
 * Call this once; it hooks into the native IPC bridge.
 *
 * The client sends events defined by the `client` schemas and receives
 * events defined by the `host` schemas — the inverse of the host side.
 *
 * @example
 * ```ts
 * import { z } from "zod";
 * import { createChannelClient } from "native-window-ipc/client";
 *
 * const ch = createChannelClient({
 *   schemas: {
 *     host: { "update-title": z.string() },
 *     client: { "user-click": z.object({ x: z.number(), y: z.number() }) },
 *   },
 * });
 *
 * ch.send("user-click", { x: 10, y: 20 }); // only client events
 * ch.on("update-title", (title) => {        // only host events
 *   document.title = title;
 * });
 * ```
 */
export function createChannelClient<H extends SchemaMap, C extends SchemaMap>(
  options: ChannelClientOptions<H, C>,
): TypedChannel<InferSchemaMap<C>, InferSchemaMap<H>> {
  const { schemas, onValidationError } = options;
  const hostSchemas = schemas.host;
  const clientSchemas = schemas.client;

  // Save Array.prototype methods to prevent prototype pollution attacks
  const _push = Array.prototype.push;
  const _indexOf = Array.prototype.indexOf;
  const _splice = Array.prototype.splice;

  const listeners = new Map<string, Set<(payload: any) => void>>();

  // Client sends C events (client schemas), receives H events (host schemas)
  const channel: TypedChannel<InferSchemaMap<C>, InferSchemaMap<H>> = {
    send<K extends keyof InferSchemaMap<C> & string>(
      ...args: SendArgs<InferSchemaMap<C>, K>
    ): void {
      const [type, payload] = args;
      window.ipc.postMessage(encode(type, payload));
    },

    on<K extends keyof InferSchemaMap<H> & string>(
      type: K,
      handler: (payload: InferSchemaMap<H>[K]) => void,
    ): void {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(handler as (payload: any) => void);
    },

    off<K extends keyof InferSchemaMap<H> & string>(
      type: K,
      handler: (payload: InferSchemaMap<H>[K]) => void,
    ): void {
      const set = listeners.get(type);
      if (set) set.delete(handler as (payload: any) => void);
    },
  };

  // External listeners for non-channel messages (e.g. native-window-tsdb)
  const externalListeners: Array<(msg: string) => void> = [];

  // Intercept incoming messages from host using atomic defineProperty
  // to eliminate the TOCTOU race between assignment and freeze.
  const orig = window.__native_message__;
  try {
    Object.defineProperty(window, "__native_message__", {
      value(msg: string): void {
        const env = decode(msg);
        if (env) {
          // Drop messages whose $ch is not a known host schema key (strict allowlist)
          if (!(env.$ch in hostSchemas)) {
            // Forward to external listeners — not a recognized channel message
            for (const fn of externalListeners) {
              try {
                fn(msg);
              } catch {}
            }
            orig?.(msg);
            return;
          }
          const set = listeners.get(env.$ch);
          if (set) {
            // Validate payload against the host schema for this channel
            const schema = hostSchemas[env.$ch];
            let validatedPayload: unknown = env.p;
            if (schema) {
              const result = validatePayload(schema, env.p);
              if (!result.success) {
                onValidationError?.(env.$ch, env.p);
                return;
              }
              validatedPayload = result.data;
            }
            for (const fn of set) {
              try {
                fn(validatedPayload);
              } catch {}
            }
            return;
          }
        }
        // Forward to external listeners (e.g. TSDB sync)
        for (const fn of externalListeners) {
          try {
            fn(msg);
          } catch {}
        }
        // Fall through to original handler for non-channel messages
        orig?.(msg);
      },
      writable: false,
      configurable: false,
    });
  } catch {}

  try {
    Object.defineProperty(window, "__native_message_listeners__", {
      value: Object.freeze({
        add(fn: (msg: string) => void): void {
          if (typeof fn === "function") _push.call(externalListeners, fn);
        },
        remove(fn: (msg: string) => void): void {
          const idx = _indexOf.call(externalListeners, fn);
          if (idx !== -1) _splice.call(externalListeners, idx, 1);
        },
      }),
      writable: false,
      configurable: false,
    });
  } catch {}

  try {
    Object.defineProperty(window, "__channel__", {
      value: channel,
      writable: false,
      configurable: false,
    });
  } catch {}

  return channel;
}
