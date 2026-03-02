import { test, expect, describe } from "vitest";
import { createChannel, getClientScript } from "../index.ts";
import type { SchemaLike } from "../index.ts";

// ── Mock NativeWindow ─────────────────────────────────────────────

/** Minimal mock of NativeWindow for testing the channel layer. */
function createMockWindow() {
  let messageHandler: ((msg: string, sourceUrl: string) => void) | null = null;
  let pageLoadHandler: ((event: "started" | "finished", url: string) => void) | null = null;
  const posted: string[] = [];
  const evaluated: string[] = [];

  return {
    id: 1,
    // Capture the registered handlers
    onMessage(cb: (msg: string, sourceUrl: string) => void) {
      messageHandler = cb;
    },
    onPageLoad(cb: (event: "started" | "finished", url: string) => void) {
      pageLoadHandler = cb;
    },
    postMessage(msg: string) {
      posted.push(msg);
    },
    unsafe: {
      evaluateJs(script: string) {
        evaluated.push(script);
      },
    },
    // Test helpers
    _simulateIncoming(msg: string, sourceUrl: string = "https://localhost") {
      messageHandler?.(msg, sourceUrl);
    },
    _simulatePageLoad(event: "started" | "finished", url: string) {
      pageLoadHandler?.(event, url);
    },
    _posted: posted,
    _evaluated: evaluated,
    // Stubs for remaining NativeWindow methods
    loadUrl(_url: string) {},
    loadHtml(_html: string) {},
    setTitle(_t: string) {},
    setSize(_w: number, _h: number) {},
    setMinSize(_w: number, _h: number) {},
    setMaxSize(_w: number, _h: number) {},
    setPosition(_x: number, _y: number) {},
    setResizable(_r: boolean) {},
    setDecorations(_d: boolean) {},
    setAlwaysOnTop(_a: boolean) {},
    show() {},
    hide() {},
    close() {},
    focus() {},
    maximize() {},
    minimize() {},
    unmaximize() {},
    onClose(_cb: () => void) {},
    onResize(_cb: (w: number, h: number) => void) {},
    onMove(_cb: (x: number, y: number) => void) {},
    onFocus(_cb: () => void) {},
    onBlur(_cb: () => void) {},
    onTitleChanged(_cb: (t: string) => void) {},
  };
}

// ── Mock schemas ──────────────────────────────────────────────────

/** Minimal SchemaLike-compatible mock for testing without Zod. */
function mockSchema<T>(guard: (v: unknown) => v is T): SchemaLike & { _zod: { output: T } } {
  return {
    _zod: { output: undefined as unknown as T },
    safeParse(data: unknown) {
      return guard(data)
        ? { success: true as const, data: data as T }
        : { success: false as const, error: "validation failed" };
    },
  };
}

const stringSchema = mockSchema((v: unknown): v is string => typeof v === "string");
const numberSchema = mockSchema((v: unknown): v is number => typeof v === "number");
const pointSchema = mockSchema(
  (v: unknown): v is { x: number; y: number } =>
    typeof v === "object" &&
    v !== null &&
    typeof (v as any).x === "number" &&
    typeof (v as any).y === "number",
);

const testSchemas = {
  ping: stringSchema,
  pong: numberSchema,
  data: pointSchema,
};

// ── Tests ──────────────────────────────────────────────────────────

describe("createChannel", () => {
  test("send() encodes messages with $ch envelope", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: testSchemas,
    });

    ch.send("ping", "hello");

    expect(win._posted).toHaveLength(1);
    const parsed = JSON.parse(win._posted[0]!);
    expect(parsed).toEqual({ $ch: "ping", p: "hello" });
  });

  test("send() encodes object payloads", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: testSchemas,
    });

    ch.send("data", { x: 10, y: 20 });

    const parsed = JSON.parse(win._posted[0]!);
    expect(parsed).toEqual({ $ch: "data", p: { x: 10, y: 20 } });
  });

  test("on() receives decoded messages", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: testSchemas,
    });

    const received: string[] = [];
    ch.on("ping", (msg) => received.push(msg));

    // Simulate incoming envelope
    win._simulateIncoming(JSON.stringify({ $ch: "ping", p: "world" }));

    expect(received).toEqual(["world"]);
  });

  test("on() receives number payloads", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: testSchemas,
    });

    const received: number[] = [];
    ch.on("pong", (n) => received.push(n));

    win._simulateIncoming(JSON.stringify({ $ch: "pong", p: 42 }));

    expect(received).toEqual([42]);
  });

  test("on() receives object payloads", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: testSchemas,
    });

    const received: { x: number; y: number }[] = [];
    ch.on("data", (d) => received.push(d));

    win._simulateIncoming(JSON.stringify({ $ch: "data", p: { x: 5, y: 15 } }));

    expect(received).toEqual([{ x: 5, y: 15 }]);
  });

  test("on() ignores messages for other channels", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: testSchemas,
    });

    const received: string[] = [];
    ch.on("ping", (msg) => received.push(msg));

    // Different channel
    win._simulateIncoming(JSON.stringify({ $ch: "pong", p: 99 }));

    expect(received).toHaveLength(0);
  });

  test("on() ignores non-envelope messages", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: testSchemas,
    });

    const received: string[] = [];
    ch.on("ping", (msg) => received.push(msg));

    // Raw string, not a valid envelope
    win._simulateIncoming("just a plain string");

    expect(received).toHaveLength(0);
  });

  test("on() ignores invalid JSON", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: testSchemas,
    });

    const received: string[] = [];
    ch.on("ping", (msg) => received.push(msg));

    win._simulateIncoming("{bad json}}}");

    expect(received).toHaveLength(0);
  });

  test("off() removes a handler", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: testSchemas,
    });

    const received: string[] = [];
    const handler = (msg: string) => received.push(msg);

    ch.on("ping", handler);
    win._simulateIncoming(JSON.stringify({ $ch: "ping", p: "first" }));
    expect(received).toEqual(["first"]);

    ch.off("ping", handler);
    win._simulateIncoming(JSON.stringify({ $ch: "ping", p: "second" }));
    expect(received).toEqual(["first"]); // not called again
  });

  test("multiple handlers on same channel", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: testSchemas,
    });

    const a: string[] = [];
    const b: string[] = [];
    ch.on("ping", (msg) => a.push(msg));
    ch.on("ping", (msg) => b.push(msg));

    win._simulateIncoming(JSON.stringify({ $ch: "ping", p: "hello" }));

    expect(a).toEqual(["hello"]);
    expect(b).toEqual(["hello"]);
  });

  test("injectClient: true injects client script", () => {
    const win = createMockWindow();
    createChannel(win as any, {
      injectClient: true,
      schemas: testSchemas,
    });

    // Should have evaluated the client script
    expect(win._evaluated.length).toBeGreaterThanOrEqual(1);
    expect(win._evaluated[0]).toContain("__channel__");
  });

  test("injectClient: false does not inject client script", () => {
    const win = createMockWindow();
    createChannel(win as any, {
      injectClient: false,
      schemas: testSchemas,
    });

    expect(win._evaluated).toHaveLength(0);
  });

  test("re-injects client on page load finished", () => {
    const win = createMockWindow();
    createChannel(win as any, {
      injectClient: true,
      schemas: testSchemas,
    });

    const initialCount = win._evaluated.length;

    // Simulate navigation
    win._simulatePageLoad("started", "https://example.com");
    expect(win._evaluated.length).toBe(initialCount); // no re-inject on started

    win._simulatePageLoad("finished", "https://example.com");
    expect(win._evaluated.length).toBe(initialCount + 1); // re-injected
    expect(win._evaluated[win._evaluated.length - 1]).toContain("__channel__");
  });

  test("window property returns the underlying NativeWindow", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: testSchemas,
    });

    expect(ch.window as any).toBe(win);
  });
});

describe("getClientScript", () => {
  test("returns a non-empty string", () => {
    const script = getClientScript();
    expect(typeof script).toBe("string");
    expect(script.length).toBeGreaterThan(0);
  });

  test("contains __channel__ assignment", () => {
    const script = getClientScript();
    expect(script).toContain("__channel__");
  });

  test("contains ipc.postMessage bridge", () => {
    const script = getClientScript();
    expect(script).toContain("ipc.postMessage");
  });

  test("contains envelope encoding ($ch)", () => {
    const script = getClientScript();
    expect(script).toContain("$ch");
  });

  test("locks __channel__ with Object.defineProperty (prevents overwrite)", () => {
    const script = getClientScript();
    expect(script).toContain("Object.defineProperty(window,'__channel__'");
    expect(script).toContain("writable:false");
    expect(script).toContain("configurable:false");
  });

  test("locks __native_message__ with Object.defineProperty", () => {
    const script = getClientScript();
    expect(script).toContain("Object.defineProperty(window,'__native_message__'");
  });

  test("exposes __native_message_listeners__ as frozen {add, remove} registry", () => {
    const script = getClientScript();
    expect(script).toContain("__native_message_listeners__");
    expect(script).toContain("Object.defineProperty(window,'__native_message_listeners__'");
    expect(script).toContain("Object.freeze(");
    expect(script).toContain("add:function(fn)");
    expect(script).toContain("remove:function(fn)");
  });

  test("forwards unhandled messages to external listeners with try/catch", () => {
    const script = getClientScript();
    // The injected script iterates _el (external listeners) for messages
    // not matching any registered channel
    expect(script).toContain("_el");
    // Verify the forwarding loop wraps each call in try/catch
    expect(script).toMatch(/try\{_el\[j\]\(msg\)\}catch/);
  });

  test("captures Array.prototype.slice and filter for prototype safety", () => {
    const script = getClientScript();
    expect(script).toContain("Array.prototype.slice");
    expect(script).toContain("Array.prototype.filter");
  });

  test("saves Array.prototype.push, indexOf, splice for registry safety", () => {
    const script = getClientScript();
    expect(script).toContain("Array.prototype.push");
    expect(script).toContain("Array.prototype.indexOf");
    expect(script).toContain("Array.prototype.splice");
  });

  test("registry add/remove use saved prototype methods (not Array.prototype directly)", () => {
    const script = getClientScript();
    // The add function should use _push.call, not _el.push
    expect(script).toContain("_push.call(_el,fn)");
    // The remove function should use _indexOf.call and _splice.call
    expect(script).toContain("_indexOf.call(_el,fn)");
    expect(script).toContain("_splice.call(_el,");
  });

  test("listener registry uses Object.create(null) to prevent prototype key collisions", () => {
    const script = getClientScript();
    expect(script).toContain("Object.create(null)");
    // Should NOT contain plain object literal for _l
    expect(script).not.toMatch(/var _l=\{\}/);
  });

  test("defines __native_message__ atomically via Object.defineProperty with value", () => {
    const script = getClientScript();
    // The handler should be defined as a value inside defineProperty, not assigned then frozen
    expect(script).toMatch(
      /Object\.defineProperty\(window,'__native_message__',\{value:function\(msg\)/,
    );
  });

  test("wraps per-handler dispatch in try/catch for error isolation", () => {
    const script = getClientScript();
    // The handler dispatch loop should wrap each call in try/catch
    expect(script).toMatch(/try\{fns\[i\]\(env\.p\)\}catch/);
  });
});

// ── Schema validation ─────────────────────────────────────────────

describe("schema validation", () => {
  test("valid payload passes through to handler", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: { ping: stringSchema },
    });

    const received: string[] = [];
    ch.on("ping", (msg) => received.push(msg));
    win._simulateIncoming(JSON.stringify({ $ch: "ping", p: "hello" }));

    expect(received).toEqual(["hello"]);
  });

  test("invalid payload is rejected and handler not called", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: { ping: stringSchema },
    });

    const received: string[] = [];
    ch.on("ping", (msg) => received.push(msg));
    // Send a number instead of string
    win._simulateIncoming(JSON.stringify({ $ch: "ping", p: 12345 }));

    expect(received).toHaveLength(0);
  });

  test("missing schema for event allows passthrough", () => {
    const win = createMockWindow();
    // Only define schema for "ping", not "pong"
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: { ping: stringSchema, pong: numberSchema },
    });

    // Send to an event not in schemas (simulated via raw envelope)
    const received: number[] = [];
    ch.on("pong", (n) => received.push(n));
    win._simulateIncoming(JSON.stringify({ $ch: "pong", p: 42 }));

    expect(received).toEqual([42]);
  });

  test("drops messages with $ch not present in schemas (strict allowlist)", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: { ping: stringSchema },
    });

    const received: unknown[] = [];
    // Register a handler for an event not in schemas (bypassing TS types)
    (ch as any).on("unknown", (p: unknown) => received.push(p));
    win._simulateIncoming(JSON.stringify({ $ch: "unknown", p: "malicious" }));

    expect(received).toHaveLength(0);
  });

  test("onValidationError is called on failure", () => {
    const win = createMockWindow();
    const errors: { type: string; payload: unknown }[] = [];
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: { ping: stringSchema },
      onValidationError: (type, payload) => errors.push({ type, payload }),
    });

    ch.on("ping", () => {});
    win._simulateIncoming(JSON.stringify({ $ch: "ping", p: 999 }));

    expect(errors).toEqual([{ type: "ping", payload: 999 }]);
  });

  test("decode rejects messages exceeding maxMessageSize", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: { ping: stringSchema },
      maxMessageSize: 50,
    });

    const received: string[] = [];
    ch.on("ping", (msg) => received.push(msg));

    // Create a message that exceeds the 50-character limit
    const largePayload = "x".repeat(100);
    win._simulateIncoming(JSON.stringify({ $ch: "ping", p: largePayload }));

    expect(received).toHaveLength(0);
  });

  test("decode strips __proto__ from parsed JSON to prevent prototype pollution", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: { ping: pointSchema },
    });

    const received: any[] = [];
    ch.on("ping", (msg) => received.push(msg));

    // Craft a message with __proto__ key in the payload
    const malicious = '{"$ch":"ping","p":{"x":1,"y":2,"__proto__":{"polluted":true}}}';
    win._simulateIncoming(malicious);

    expect(received).toHaveLength(1);
    // The __proto__ key should not have polluted Object.prototype
    expect(({} as any).polluted).toBeUndefined();
  });

  test("handler exception does not prevent other handlers from running", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: { ping: stringSchema },
    });

    const received: string[] = [];
    ch.on("ping", () => {
      throw new Error("handler error");
    });
    ch.on("ping", (msg) => received.push(msg));

    win._simulateIncoming(JSON.stringify({ $ch: "ping", p: "hello" }));

    // Second handler should still run despite first throwing
    expect(received).toEqual(["hello"]);
  });
});

// ── Trusted origins ───────────────────────────────────────────────

describe("trustedOrigins", () => {
  test("re-injects on page load when origin matches", () => {
    const win = createMockWindow();
    createChannel(win as any, {
      schemas: testSchemas,
      trustedOrigins: ["https://myapp.com"],
    });

    const initialCount = win._evaluated.length;

    win._simulatePageLoad("finished", "https://myapp.com/page");
    expect(win._evaluated.length).toBe(initialCount + 1);
  });

  test("does not re-inject when origin does not match", () => {
    const win = createMockWindow();
    createChannel(win as any, {
      schemas: testSchemas,
      trustedOrigins: ["https://myapp.com"],
    });

    const initialCount = win._evaluated.length;

    win._simulatePageLoad("finished", "https://evil.com/phish");
    expect(win._evaluated.length).toBe(initialCount);
  });

  test("defers initial injection when trustedOrigins is set", () => {
    const win = createMockWindow();
    createChannel(win as any, {
      schemas: testSchemas,
      trustedOrigins: ["https://myapp.com"],
    });

    // Initial injection is deferred to prevent exposing the IPC bridge
    // to untrusted origins before the first navigation completes
    expect(win._evaluated.length).toBe(0);
  });

  test("no trustedOrigins allows all re-injections", () => {
    const win = createMockWindow();
    createChannel(win as any, {
      schemas: testSchemas,
    });

    const initialCount = win._evaluated.length;

    win._simulatePageLoad("finished", "https://any-domain.com/page");
    expect(win._evaluated.length).toBe(initialCount + 1);
  });

  test("malformed URL is treated as untrusted", () => {
    const win = createMockWindow();
    createChannel(win as any, {
      schemas: testSchemas,
      trustedOrigins: ["https://myapp.com"],
    });

    const initialCount = win._evaluated.length;

    win._simulatePageLoad("finished", "not-a-valid-url");
    expect(win._evaluated.length).toBe(initialCount);
  });

  test("rejects incoming messages from untrusted origin", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: testSchemas,
      trustedOrigins: ["https://myapp.com"],
    });

    const received: string[] = [];
    ch.on("ping", (msg) => received.push(msg));

    win._simulateIncoming(JSON.stringify({ $ch: "ping", p: "evil" }), "https://evil.com");

    expect(received).toHaveLength(0);
  });

  test("accepts incoming messages from trusted origin", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: testSchemas,
      trustedOrigins: ["https://myapp.com"],
    });

    const received: string[] = [];
    ch.on("ping", (msg) => received.push(msg));

    win._simulateIncoming(JSON.stringify({ $ch: "ping", p: "safe" }), "https://myapp.com/page");

    expect(received).toEqual(["safe"]);
  });

  test("rejects incoming messages with empty sourceUrl when trustedOrigins is set", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: testSchemas,
      trustedOrigins: ["https://myapp.com"],
    });

    const received: string[] = [];
    ch.on("ping", (msg) => received.push(msg));

    win._simulateIncoming(JSON.stringify({ $ch: "ping", p: "blank" }), "");

    expect(received).toHaveLength(0);
  });

  test("no trustedOrigins allows messages from any origin", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: testSchemas,
    });

    const received: string[] = [];
    ch.on("ping", (msg) => received.push(msg));

    win._simulateIncoming(JSON.stringify({ $ch: "ping", p: "any" }), "https://random.com");

    expect(received).toEqual(["any"]);
  });

  test("normalizes case-insensitive origins (HTTPS://EXAMPLE.COM matches https://example.com)", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: testSchemas,
      trustedOrigins: ["HTTPS://EXAMPLE.COM"],
    });

    const received: string[] = [];
    ch.on("ping", (msg) => received.push(msg));

    win._simulateIncoming(
      JSON.stringify({ $ch: "ping", p: "normalized" }),
      "https://example.com/page",
    );

    expect(received).toEqual(["normalized"]);
  });

  test("normalizes default port (https://example.com:443 matches https://example.com)", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: testSchemas,
      trustedOrigins: ["https://example.com:443"],
    });

    const received: string[] = [];
    ch.on("ping", (msg) => received.push(msg));

    win._simulateIncoming(
      JSON.stringify({ $ch: "ping", p: "port-normalized" }),
      "https://example.com/page",
    );

    expect(received).toEqual(["port-normalized"]);
  });

  test("normalizes default port for http (http://example.com:80 matches http://example.com)", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: testSchemas,
      trustedOrigins: ["http://example.com:80"],
    });

    const received: string[] = [];
    ch.on("ping", (msg) => received.push(msg));

    win._simulateIncoming(
      JSON.stringify({ $ch: "ping", p: "http-port" }),
      "http://example.com/page",
    );

    expect(received).toEqual(["http-port"]);
  });

  test("malformed trusted origins are silently filtered out", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: testSchemas,
      trustedOrigins: ["not-a-url", "https://valid.com", ":::bad"],
    });

    const received: string[] = [];
    ch.on("ping", (msg) => received.push(msg));

    // Valid origin should still work
    win._simulateIncoming(JSON.stringify({ $ch: "ping", p: "ok" }), "https://valid.com/page");

    expect(received).toEqual(["ok"]);
  });

  test("re-injects on page load with case-normalized origin", () => {
    const win = createMockWindow();
    createChannel(win as any, {
      schemas: testSchemas,
      trustedOrigins: ["HTTPS://MYAPP.COM"],
    });

    const initialCount = win._evaluated.length;

    win._simulatePageLoad("finished", "https://myapp.com/page");
    expect(win._evaluated.length).toBe(initialCount + 1);
  });
});

// ── Zod schema validation ─────────────────────────────────────────

import { z } from "zod";

describe("Zod schema validation", () => {
  test("valid payload passes schema validation", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: { ping: z.string(), pong: z.number() },
    });

    const received: string[] = [];
    ch.on("ping", (msg) => received.push(msg));
    win._simulateIncoming(JSON.stringify({ $ch: "ping", p: "hello" }));

    expect(received).toEqual(["hello"]);
  });

  test("invalid payload is rejected by schema", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: { ping: z.string() },
    });

    const received: string[] = [];
    ch.on("ping", (msg) => received.push(msg));
    win._simulateIncoming(JSON.stringify({ $ch: "ping", p: 12345 }));

    expect(received).toHaveLength(0);
  });

  test("onValidationError fires on schema failure", () => {
    const win = createMockWindow();
    const errors: { type: string; payload: unknown }[] = [];
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: { ping: z.string() },
      onValidationError: (type, payload) => errors.push({ type, payload }),
    });

    ch.on("ping", () => {});
    win._simulateIncoming(JSON.stringify({ $ch: "ping", p: 999 }));

    expect(errors).toEqual([{ type: "ping", payload: 999 }]);
  });

  test("object schema validates nested structure", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: {
        data: z.object({ x: z.number(), y: z.number() }),
      },
    });

    const received: { x: number; y: number }[] = [];
    ch.on("data", (d) => received.push(d));

    // Valid
    win._simulateIncoming(JSON.stringify({ $ch: "data", p: { x: 1, y: 2 } }));
    expect(received).toEqual([{ x: 1, y: 2 }]);

    // Invalid (missing field)
    win._simulateIncoming(JSON.stringify({ $ch: "data", p: { x: 1 } }));
    expect(received).toHaveLength(1); // still only the valid one
  });

  test("send() encodes messages with schema-inferred types", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: {
        ping: z.string(),
        pong: z.number(),
        data: z.object({ x: z.number(), y: z.number() }),
      },
    });

    ch.send("ping", "hello");
    ch.send("pong", 42);
    ch.send("data", { x: 1, y: 2 });

    expect(win._posted).toHaveLength(3);
    expect(JSON.parse(win._posted[0]!)).toEqual({ $ch: "ping", p: "hello" });
    expect(JSON.parse(win._posted[1]!)).toEqual({ $ch: "pong", p: 42 });
    expect(JSON.parse(win._posted[2]!)).toEqual({
      $ch: "data",
      p: { x: 1, y: 2 },
    });
  });

  test("multiple schemas validate independently", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: {
        ping: z.string(),
        pong: z.number(),
      },
    });

    const pings: string[] = [];
    const pongs: number[] = [];
    ch.on("ping", (msg) => pings.push(msg));
    ch.on("pong", (n) => pongs.push(n));

    // Valid for both
    win._simulateIncoming(JSON.stringify({ $ch: "ping", p: "hi" }));
    win._simulateIncoming(JSON.stringify({ $ch: "pong", p: 7 }));

    // Invalid: wrong types
    win._simulateIncoming(JSON.stringify({ $ch: "ping", p: 123 }));
    win._simulateIncoming(JSON.stringify({ $ch: "pong", p: "nope" }));

    expect(pings).toEqual(["hi"]);
    expect(pongs).toEqual([7]);
  });
});

// ── Valibot schema validation ─────────────────────────────────────

import * as v from "valibot";

/**
 * Wraps a Valibot schema into a {@link SchemaLike}-compatible object.
 * Valibot uses a functional `safeParse(schema, data)` API rather than
 * a method on the schema, so we bridge it here.
 */
function valibotAdapter(schema: v.GenericSchema): SchemaLike {
  return {
    safeParse(data: unknown) {
      const result = v.safeParse(schema, data);
      return result.success
        ? { success: true as const, data: result.output }
        : { success: false as const, error: result.issues };
    },
  };
}

describe("Valibot schema validation", () => {
  test("valid payload passes schema validation", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: {
        ping: valibotAdapter(v.string()),
        pong: valibotAdapter(v.number()),
      },
    });

    const received: string[] = [];
    ch.on("ping", (msg: any) => received.push(msg));
    win._simulateIncoming(JSON.stringify({ $ch: "ping", p: "hello" }));

    expect(received).toEqual(["hello"]);
  });

  test("invalid payload is rejected by schema", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: { ping: valibotAdapter(v.string()) },
    });

    const received: string[] = [];
    ch.on("ping", (msg: any) => received.push(msg));
    win._simulateIncoming(JSON.stringify({ $ch: "ping", p: 12345 }));

    expect(received).toHaveLength(0);
  });

  test("onValidationError fires on schema failure", () => {
    const win = createMockWindow();
    const errors: { type: string; payload: unknown }[] = [];
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: { ping: valibotAdapter(v.string()) },
      onValidationError: (type, payload) => errors.push({ type, payload }),
    });

    ch.on("ping", () => {});
    win._simulateIncoming(JSON.stringify({ $ch: "ping", p: 999 }));

    expect(errors).toEqual([{ type: "ping", payload: 999 }]);
  });

  test("object schema validates nested structure", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: {
        data: valibotAdapter(v.object({ x: v.number(), y: v.number() })),
      },
    });

    const received: { x: number; y: number }[] = [];
    ch.on("data", (d: any) => received.push(d));

    // Valid
    win._simulateIncoming(JSON.stringify({ $ch: "data", p: { x: 1, y: 2 } }));
    expect(received).toEqual([{ x: 1, y: 2 }]);

    // Invalid (missing field)
    win._simulateIncoming(JSON.stringify({ $ch: "data", p: { x: 1 } }));
    expect(received).toHaveLength(1); // still only the valid one
  });

  test("send() encodes messages with wrapped schemas", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: {
        ping: valibotAdapter(v.string()),
        pong: valibotAdapter(v.number()),
        data: valibotAdapter(v.object({ x: v.number(), y: v.number() })),
      },
    });

    ch.send("ping", "hello");
    ch.send("pong", 42);
    ch.send("data", { x: 1, y: 2 });

    expect(win._posted).toHaveLength(3);
    expect(JSON.parse(win._posted[0]!)).toEqual({ $ch: "ping", p: "hello" });
    expect(JSON.parse(win._posted[1]!)).toEqual({ $ch: "pong", p: 42 });
    expect(JSON.parse(win._posted[2]!)).toEqual({
      $ch: "data",
      p: { x: 1, y: 2 },
    });
  });

  test("multiple schemas validate independently", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: {
        ping: valibotAdapter(v.string()),
        pong: valibotAdapter(v.number()),
      },
    });

    const pings: string[] = [];
    const pongs: number[] = [];
    ch.on("ping", (msg: any) => pings.push(msg));
    ch.on("pong", (n: any) => pongs.push(n));

    // Valid for both
    win._simulateIncoming(JSON.stringify({ $ch: "ping", p: "hi" }));
    win._simulateIncoming(JSON.stringify({ $ch: "pong", p: 7 }));

    // Invalid: wrong types
    win._simulateIncoming(JSON.stringify({ $ch: "ping", p: 123 }));
    win._simulateIncoming(JSON.stringify({ $ch: "pong", p: "nope" }));

    expect(pings).toEqual(["hi"]);
    expect(pongs).toEqual([7]);
  });
});

// ── ArkType schema validation ─────────────────────────────────────

import { type } from "arktype";

/**
 * Wraps an ArkType `Type` into a {@link SchemaLike}-compatible object.
 * ArkType returns validated data directly or a `type.errors` instance,
 * so we bridge it to the `safeParse` contract here.
 */
function arktypeAdapter(schema: type.Any): SchemaLike {
  return {
    safeParse(data: unknown) {
      const out = schema(data);
      return out instanceof type.errors
        ? { success: false as const, error: out.summary }
        : { success: true as const, data: out };
    },
  };
}

describe("ArkType schema validation", () => {
  test("valid payload passes schema validation", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: {
        ping: arktypeAdapter(type("string")),
        pong: arktypeAdapter(type("number")),
      },
    });

    const received: string[] = [];
    ch.on("ping", (msg: any) => received.push(msg));
    win._simulateIncoming(JSON.stringify({ $ch: "ping", p: "hello" }));

    expect(received).toEqual(["hello"]);
  });

  test("invalid payload is rejected by schema", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: { ping: arktypeAdapter(type("string")) },
    });

    const received: string[] = [];
    ch.on("ping", (msg: any) => received.push(msg));
    win._simulateIncoming(JSON.stringify({ $ch: "ping", p: 12345 }));

    expect(received).toHaveLength(0);
  });

  test("onValidationError fires on schema failure", () => {
    const win = createMockWindow();
    const errors: { type: string; payload: unknown }[] = [];
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: { ping: arktypeAdapter(type("string")) },
      onValidationError: (tp, payload) => errors.push({ type: tp, payload }),
    });

    ch.on("ping", () => {});
    win._simulateIncoming(JSON.stringify({ $ch: "ping", p: 999 }));

    expect(errors).toEqual([{ type: "ping", payload: 999 }]);
  });

  test("object schema validates nested structure", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: {
        data: arktypeAdapter(type({ x: "number", y: "number" })),
      },
    });

    const received: { x: number; y: number }[] = [];
    ch.on("data", (d: any) => received.push(d));

    // Valid
    win._simulateIncoming(JSON.stringify({ $ch: "data", p: { x: 1, y: 2 } }));
    expect(received).toEqual([{ x: 1, y: 2 }]);

    // Invalid (missing field)
    win._simulateIncoming(JSON.stringify({ $ch: "data", p: { x: 1 } }));
    expect(received).toHaveLength(1); // still only the valid one
  });

  test("send() encodes messages with wrapped schemas", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: {
        ping: arktypeAdapter(type("string")),
        pong: arktypeAdapter(type("number")),
        data: arktypeAdapter(type({ x: "number", y: "number" })),
      },
    });

    ch.send("ping", "hello");
    ch.send("pong", 42);
    ch.send("data", { x: 1, y: 2 });

    expect(win._posted).toHaveLength(3);
    expect(JSON.parse(win._posted[0]!)).toEqual({ $ch: "ping", p: "hello" });
    expect(JSON.parse(win._posted[1]!)).toEqual({ $ch: "pong", p: 42 });
    expect(JSON.parse(win._posted[2]!)).toEqual({
      $ch: "data",
      p: { x: 1, y: 2 },
    });
  });

  test("multiple schemas validate independently", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: {
        ping: arktypeAdapter(type("string")),
        pong: arktypeAdapter(type("number")),
      },
    });

    const pings: string[] = [];
    const pongs: number[] = [];
    ch.on("ping", (msg: any) => pings.push(msg));
    ch.on("pong", (n: any) => pongs.push(n));

    // Valid for both
    win._simulateIncoming(JSON.stringify({ $ch: "ping", p: "hi" }));
    win._simulateIncoming(JSON.stringify({ $ch: "pong", p: 7 }));

    // Invalid: wrong types
    win._simulateIncoming(JSON.stringify({ $ch: "ping", p: 123 }));
    win._simulateIncoming(JSON.stringify({ $ch: "pong", p: "nope" }));

    expect(pings).toEqual(["hi"]);
    expect(pongs).toEqual([7]);
  });
});

// ── Void payload (optional second argument) ───────────────────────

describe("void payload", () => {
  const voidSchema = mockSchema((v: unknown): v is void => v === undefined || v === null);

  test("send() works without payload argument for void events", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: { ping: voidSchema, pong: numberSchema },
    });

    // void event — omit payload
    ch.send("ping");

    expect(win._posted).toHaveLength(1);
    const parsed = JSON.parse(win._posted[0]!);
    expect(parsed).toEqual({ $ch: "ping", p: undefined });
  });

  test("send() still accepts payload argument for void events", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: { ping: voidSchema },
    });

    // void event — explicit undefined payload
    ch.send("ping", undefined as void);

    expect(win._posted).toHaveLength(1);
    const parsed = JSON.parse(win._posted[0]!);
    expect(parsed).toEqual({ $ch: "ping" });
  });

  test("send() still requires payload for non-void events", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: { pong: numberSchema },
    });

    ch.send("pong", 42);

    expect(win._posted).toHaveLength(1);
    const parsed = JSON.parse(win._posted[0]!);
    expect(parsed).toEqual({ $ch: "pong", p: 42 });
  });

  test("void-payload message survives encode/decode round-trip and dispatches handler", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: { ping: voidSchema },
    });

    const calls: unknown[] = [];
    ch.on("ping", () => {
      calls.push("called");
    });

    // Simulate what happens when the client sends a void-payload message:
    // JSON.stringify({ $ch: "ping", p: undefined }) produces '{"$ch":"ping"}'
    // (the p key is stripped). The host must still decode and dispatch it.
    win._simulateIncoming(JSON.stringify({ $ch: "ping", p: undefined }));

    expect(calls).toEqual(["called"]);
  });
});

// ── Channel namespace (channelId) ─────────────────────────────────

describe("channelId namespace", () => {
  test("channelId prefixes outgoing $ch values", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: { ping: stringSchema },
      channelId: "ns1",
    });

    ch.send("ping", "hello");

    const parsed = JSON.parse(win._posted[0]!);
    expect(parsed.$ch).toBe("ns1:ping");
    expect(parsed.p).toBe("hello");
  });

  test("channelId drops messages with wrong prefix", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: { ping: stringSchema },
      channelId: "ns1",
    });

    const received: string[] = [];
    ch.on("ping", (msg) => received.push(msg));

    // Message with wrong prefix
    win._simulateIncoming(JSON.stringify({ $ch: "wrong:ping", p: "evil" }));
    expect(received).toHaveLength(0);

    // Message with no prefix
    win._simulateIncoming(JSON.stringify({ $ch: "ping", p: "sneaky" }));
    expect(received).toHaveLength(0);
  });

  test("channelId accepts messages with correct prefix", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: { ping: stringSchema },
      channelId: "ns1",
    });

    const received: string[] = [];
    ch.on("ping", (msg) => received.push(msg));

    win._simulateIncoming(JSON.stringify({ $ch: "ns1:ping", p: "safe" }));
    expect(received).toEqual(["safe"]);
  });

  test("channelId: true generates a random nonce", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: { ping: stringSchema },
      channelId: true,
    });

    ch.send("ping", "test");

    const parsed = JSON.parse(win._posted[0]!);
    // Should be "randomnonce:ping" format
    expect(parsed.$ch).toMatch(/^[a-z0-9]+:ping$/);
    expect(parsed.$ch).not.toBe("ping");
  });

  test("no channelId preserves original behavior", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: { ping: stringSchema },
    });

    ch.send("ping", "hello");

    const parsed = JSON.parse(win._posted[0]!);
    expect(parsed.$ch).toBe("ping");
  });

  test("channelId is embedded in injected client script", () => {
    const win = createMockWindow();
    createChannel(win as any, {
      injectClient: true,
      schemas: { ping: stringSchema },
      channelId: "myns",
    });

    expect(win._evaluated.length).toBeGreaterThanOrEqual(1);
    expect(win._evaluated[0]).toContain('"myns"');
  });

  test("injected client script includes _uch unprefix function", () => {
    const script = getClientScript({ channelId: "test" });
    expect(script).toContain("function _uch(ch)");
    expect(script).toContain('"test"');
  });

  test("injected client script prefixes in _e encode function", () => {
    const script = getClientScript({ channelId: "abc" });
    // The encode function should include the prefix concatenation
    expect(script).toContain('_pfx+":"+t');
  });

  test("injected client script without channelId has empty prefix", () => {
    const script = getClientScript();
    // No prefix — _pfx should be ""
    expect(script).toContain('var _pfx=""');
  });
});

describe("injected script hardening", () => {
  test("injected _d() includes size limit check (1 MB)", () => {
    const script = getClientScript();
    expect(script).toContain("r.length>1048576");
  });

  test("injected _d() strips dangerous keys via JSON reviver", () => {
    const script = getClientScript();
    // Reviver filters __proto__, constructor, and prototype at all nesting levels
    expect(script).toMatch(/__proto__/);
    expect(script).toMatch(/constructor/);
    expect(script).toMatch(/prototype/);
    expect(script).toMatch(/JSON\.parse\(r,function/);
  });

  test("injected ch object is frozen to prevent monkey-patching", () => {
    const script = getClientScript();
    expect(script).toMatch(/Object\.freeze\(ch\)/);
  });
});

// ── Schema transform support (safeParse().data) ───────────────────

describe("schema transform support", () => {
  test("handler receives safeParse().data, not raw payload (transform support)", () => {
    const win = createMockWindow();
    const transformSchema: import("../index.ts").SchemaLike = {
      safeParse(data: unknown) {
        if (typeof data === "string") {
          return { success: true as const, data: data.toUpperCase() };
        }
        return { success: false as const };
      },
    };
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: { ping: transformSchema },
    });

    const received: unknown[] = [];
    ch.on("ping", (msg) => received.push(msg));
    win._simulateIncoming(JSON.stringify({ $ch: "ping", p: "hello" }));

    expect(received).toEqual(["HELLO"]);
  });

  test("handler receives raw payload when schema has no transform", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: { ping: stringSchema },
    });

    const received: unknown[] = [];
    ch.on("ping", (msg) => received.push(msg));
    win._simulateIncoming(JSON.stringify({ $ch: "ping", p: "hello" }));

    expect(received).toEqual(["hello"]);
  });
});

// ── Rate limiting ─────────────────────────────────────────────────

describe("rate limiting", () => {
  test("drops messages exceeding rateLimit per second", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: { ping: stringSchema },
      rateLimit: 3,
    });

    const received: string[] = [];
    ch.on("ping", (msg) => received.push(msg));

    // Send 5 messages rapidly (within the same millisecond)
    for (let i = 0; i < 5; i++) {
      win._simulateIncoming(JSON.stringify({ $ch: "ping", p: `msg${i}` }));
    }

    expect(received).toHaveLength(3);
    expect(received).toEqual(["msg0", "msg1", "msg2"]);
  });

  test("no rateLimit allows unlimited messages", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: { ping: stringSchema },
    });

    const received: string[] = [];
    ch.on("ping", (msg) => received.push(msg));

    for (let i = 0; i < 100; i++) {
      win._simulateIncoming(JSON.stringify({ $ch: "ping", p: `msg${i}` }));
    }

    expect(received).toHaveLength(100);
  });

  test("rateLimit of 0 is treated as no limit", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: { ping: stringSchema },
      rateLimit: 0,
    });

    const received: string[] = [];
    ch.on("ping", (msg) => received.push(msg));

    win._simulateIncoming(JSON.stringify({ $ch: "ping", p: "test" }));
    expect(received).toHaveLength(1);
  });
});

// ── Listener limits ───────────────────────────────────────────────

describe("listener limits", () => {
  test("on() rejects event types not in schemas at runtime", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: { ping: stringSchema },
    });

    const received: unknown[] = [];
    // Register a handler for an event not in schemas (bypassing TS types)
    (ch as any).on("unknown_event", (p: unknown) => received.push(p));
    win._simulateIncoming(JSON.stringify({ $ch: "unknown_event", p: "test" }));

    expect(received).toHaveLength(0);
  });

  test("on() enforces maxListenersPerEvent", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: { ping: stringSchema },
      maxListenersPerEvent: 2,
    });

    const calls: number[] = [];
    ch.on("ping", () => calls.push(1));
    ch.on("ping", () => calls.push(2));
    ch.on("ping", () => calls.push(3)); // silently dropped

    win._simulateIncoming(JSON.stringify({ $ch: "ping", p: "test" }));
    expect(calls).toEqual([1, 2]);
  });

  test("maxListenersPerEvent does not affect different event types", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: { ping: stringSchema, pong: numberSchema },
      maxListenersPerEvent: 1,
    });

    const pings: string[] = [];
    const pongs: number[] = [];
    ch.on("ping", (msg) => pings.push(msg));
    ch.on("pong", (n) => pongs.push(n));

    win._simulateIncoming(JSON.stringify({ $ch: "ping", p: "hi" }));
    win._simulateIncoming(JSON.stringify({ $ch: "pong", p: 42 }));

    expect(pings).toEqual(["hi"]);
    expect(pongs).toEqual([42]);
  });

  test("no maxListenersPerEvent allows unlimited listeners", () => {
    const win = createMockWindow();
    const ch = createChannel(win as any, {
      injectClient: false,
      schemas: { ping: stringSchema },
    });

    const calls: number[] = [];
    for (let i = 0; i < 50; i++) {
      ch.on("ping", () => calls.push(i));
    }

    win._simulateIncoming(JSON.stringify({ $ch: "ping", p: "test" }));
    expect(calls).toHaveLength(50);
  });
});
