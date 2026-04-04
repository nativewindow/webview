# Skill: @nativewindow/ipc

Use this skill when working on the **typed IPC layer** (`packages/ipc`). This is a pure TypeScript package that provides typesafe bidirectional IPC channels between a host process and a native webview.

## Package Identity

- **npm name:** `@nativewindow/ipc`
- **Location:** `packages/ipc/`
- **Language:** Pure TypeScript — **zero runtime dependencies**
- **Exports:** `@nativewindow/ipc` (host-side) and `@nativewindow/ipc/client` (webview-side)
- **Peer deps:** `@nativewindow/webview`, `typescript`, `zod` (optional)

## Architecture

### IPC Envelope Wire Format

All typed messages use the `{$ch, p}` JSON format:

```json
{ "$ch": "event-name", "p": <payload> }
```

When `channelId` is set, the envelope becomes:

```json
{ "$ch": "prefix:event-name", "p": <payload> }
```

### Directional Schemas

The channel uses **two separate schema maps** for type safety:
- `host`: Events the host sends TO the client (webview).
- `client`: Events the client (webview) sends TO the host.

On the **host side** (`createChannel`): `send()` uses `host` schemas, `on()`/`off()` uses `client` schemas.
On the **client side** (`createChannelClient`): `send()` uses `client` schemas, `on()`/`off()` uses `host` schemas.

### Client Script Injection

A minified client script is auto-injected into the webview via `evaluateJs()`. It:
- Defines `window.__channel__` (frozen) with `send()`, `on()`, `off()`.
- Defines `window.__native_message__` (frozen) to receive messages from host.
- Defines `window.__native_message_listeners__` (frozen) for external listeners (e.g., TSDB).
- Re-injects on every page navigation (`onPageLoad("finished")`).

## File Structure

```
packages/ipc/
  index.ts        # Host-side: createChannel, createWindow, getClientScript, types
  client.ts       # Webview-side: createChannelClient
  tests/
    channel.test.ts  # Unit tests (vitest) using mock NativeWindow
```

## Key Types & Exports

### Host-side (`index.ts`)

```ts
// Type definitions
type EventMap = Record<string, unknown>;
type SchemaMap = Record<string, SchemaLike>;
type InferSchemaMap<S extends SchemaMap> = { [K in keyof S & string]: InferOutput<S[K]> };
type InferOutput<S> = /* infers from Zod v4, Valibot v1, Standard Schema */;
type SendArgs<T, K> = /* void/never payload → optional argument */;
type ValidationErrorHandler = (type: string, payload: unknown) => void;

// Schema compatibility
interface SchemaLike {
  safeParse(data: unknown): { success: true; data: unknown } | { success: false; error?: unknown };
}

// Channel types
interface TypedChannel<Send, Receive> {
  send<K extends keyof Send & string>(...args: SendArgs<Send, K>): void;
  on<K extends keyof Receive & string>(type: K, handler: (payload: Receive[K]) => void): void;
  off<K extends keyof Receive & string>(type: K, handler: (payload: Receive[K]) => void): void;
}

interface NativeWindowChannel<Send, Receive> extends TypedChannel<Send, Receive> {
  readonly window: NativeWindow;
}

// Channel options
interface ChannelOptions<H extends SchemaMap, C extends SchemaMap> {
  schemas: { host: H; client: C };
  injectClient?: boolean;              // Default: true
  onValidationError?: ValidationErrorHandler;
  trustedOrigins?: string[];           // Restrict client injection + message acceptance
  maxMessageSize?: number;             // Default: 1MB
  rateLimit?: number;                  // Messages/sec (token bucket)
  maxListenersPerEvent?: number;       // Unbounded memory protection
  channelId?: string | true;           // Namespace prefix (true = random nonce)
}

// Factory functions
function createChannel<H, C>(win: NativeWindow, options: ChannelOptions<H, C>): NativeWindowChannel<...>;
function createWindow<H, C>(windowOptions: WindowOptions | undefined, channelOptions: ChannelOptions<H, C>): NativeWindowChannel<...>;
function getClientScript(options?: { channelId?: string }): string;
```

### Client-side (`client.ts`)

```ts
interface ChannelClientOptions<H extends SchemaMap, C extends SchemaMap> {
  schemas: { host: H; client: C };
  onValidationError?: ValidationErrorHandler;
}

function createChannelClient<H, C>(options: ChannelClientOptions<H, C>): TypedChannel<InferSchemaMap<C>, InferSchemaMap<H>>;
```

## Usage Patterns

### Host-side Channel

```ts
import { z } from "zod";
import { createChannel } from "@nativewindow/ipc";
import { NativeWindow } from "@nativewindow/webview";

const win = new NativeWindow({ title: "My App" });
win.loadUrl("http://localhost:5173");

const ch = createChannel(win, {
  schemas: {
    host: { "update-title": z.string() },
    client: { "user-click": z.object({ x: z.number(), y: z.number() }) },
  },
});

ch.send("update-title", "Hello");
ch.on("user-click", (p) => console.log(p.x, p.y));
```

### Client-side (bundled webview app)

```ts
import { z } from "zod";
import { createChannelClient } from "@nativewindow/ipc/client";

const ch = createChannelClient({
  schemas: {
    host: { "update-title": z.string() },
    client: { "user-click": z.object({ x: z.number(), y: z.number() }) },
  },
});

ch.send("user-click", { x: 10, y: 20 });
ch.on("update-title", (title) => { document.title = title; });
```

## Security Features

- **Origin restriction:** `trustedOrigins` restricts both client script injection and message acceptance by URL origin.
- **Message size limit:** `maxMessageSize` (default 1MB) prevents memory exhaustion.
- **Rate limiting:** `rateLimit` with token-bucket algorithm prevents flooding.
- **Listener cap:** `maxListenersPerEvent` prevents unbounded memory growth.
- **Channel namespace:** `channelId` prevents namespace squatting from untrusted scripts.
- **Prototype pollution defense:** JSON reviver strips `__proto__`, `constructor`, `prototype` keys.
- **Schema validation:** All incoming payloads are validated against schemas; invalid payloads are dropped.
- **Strict allowlist:** Only known schema keys are accepted; unknown `$ch` values are silently dropped.

## Adding a New IPC Channel Feature — Checklist

1. **Implement** in `packages/ipc/index.ts` (host) and/or `client.ts` (webview).
2. **Add tests** in `tests/channel.test.ts`.
3. **Keep the package pure TypeScript** — no native or platform imports.
4. **Update injected client script** in `getClientScript()` if client-side behavior changes.
5. Schema library compatibility: must work with **Zod v4**, **Valibot v1**, and any `safeParse()` library.

## Testing

- **Framework:** vitest with `describe`/`test`/`expect`/`mock`.
- **Test file:** `packages/ipc/tests/channel.test.ts`
- **Uses mock NativeWindow** — no native addon needed.
- **Run all:** `vitest run` in `packages/ipc`
- **Run single:** `vitest run -t "pattern"` (e.g. `vitest run -t "send() encodes"`)
- **Naming convention:** Present-tense verb phrases (e.g. `"send() encodes messages with $ch envelope"`).

### Mock NativeWindow Pattern

```ts
function createMockWindow() {
  let messageHandler: ((msg: string, sourceUrl: string) => void) | null = null;
  let pageLoadHandler: ((event: "started" | "finished", url: string) => void) | null = null;
  const posted: string[] = [];
  const evaluated: string[] = [];

  return {
    id: 1,
    onMessage(cb) { messageHandler = cb; },
    onPageLoad(cb) { pageLoadHandler = cb; },
    postMessage(msg) { posted.push(msg); },
    evaluateJs(script) { evaluated.push(script); },
    _simulateIncoming(msg, sourceUrl = "https://localhost") { messageHandler?.(msg, sourceUrl); },
    _simulatePageLoad(event, url) { pageLoadHandler?.(event, url); },
    _posted: posted,
    _evaluated: evaluated,
    // ... stub remaining NativeWindow methods
  };
}
```

## Internal Helpers

- `encode(type, payload)` → JSON string with `{$ch, p}` envelope.
- `decode(raw, maxSize)` → `Envelope | null` with prototype pollution defense.
- `normalizeOrigin(origin)` → Lowercased, port-stripped origin via WHATWG URL.
- `isOriginTrusted(url, trustedOrigins)` → Boolean origin match check.
- `validatePayload(schema, data)` → `safeParse()` wrapper returning parsed data.

## Code Style Reminders

- `import type` for type-only imports.
- Named exports only — no default exports.
- 2-space indentation, double quotes, semicolons.
- `_` prefix for private fields/methods.
- JSDoc `/** */` with `@example` on all public exports.
- Use `??` over `||`, `?.` for optional chaining.
