import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createDataSource } from "../index.ts";
import { nativeWindowCollectionOptions } from "../client.ts";
import type { DataSource, MessageSender } from "../index.ts";

// ── Test helpers ─────────────────────────────────────────────────

type Todo = { id: string; text: string; done: boolean };

function createMockSender(): MessageSender & { _posted: string[] } {
  const posted: string[] = [];
  return {
    postMessage(msg: string): void {
      posted.push(msg);
    },
    _posted: posted,
  };
}

function lastPosted(sender: { _posted: string[] }): unknown {
  const raw = sender._posted[sender._posted.length - 1];
  return raw ? JSON.parse(raw) : undefined;
}

function createMockSyncParams() {
  const writes: Array<Record<string, unknown>> = [];
  let beginCount = 0;
  let commitCount = 0;
  let readyCount = 0;

  return {
    params: {
      collection: {},
      begin: (): void => {
        beginCount++;
      },
      write: (msg: Record<string, unknown>): void => {
        writes.push(msg);
      },
      commit: (): void => {
        commitCount++;
      },
      markReady: (): void => {
        readyCount++;
      },
      truncate: (): void => {},
    },
    _writes: writes,
    get _beginCount(): number {
      return beginCount;
    },
    get _commitCount(): number {
      return commitCount;
    },
    get _readyCount(): number {
      return readyCount;
    },
  };
}

// ── Host-side: createDataSource ──────────────────────────────────

describe("createDataSource", () => {
  let sender: ReturnType<typeof createMockSender>;
  let ds: DataSource<Todo, string>;

  beforeEach(() => {
    sender = createMockSender();
    ds = createDataSource<Todo, string>(sender, {
      channel: "tsdb:todos",
      getKey: (todo) => todo.id,
    });
  });

  test("insert() sends insert envelope with correct $ch and payload", () => {
    ds.insert({ id: "1", text: "Buy milk", done: false });

    expect(sender._posted).toHaveLength(1);
    const msg = lastPosted(sender);
    expect(msg).toEqual({
      $ch: "tsdb:todos",
      p: { t: "i", k: "1", v: { id: "1", text: "Buy milk", done: false } },
    });
  });

  test("update() sends update envelope", () => {
    ds.update("1", { id: "1", text: "Buy oat milk", done: true });

    expect(sender._posted).toHaveLength(1);
    const msg = lastPosted(sender);
    expect(msg).toEqual({
      $ch: "tsdb:todos",
      p: {
        t: "u",
        k: "1",
        v: { id: "1", text: "Buy oat milk", done: true },
      },
    });
  });

  test("delete() sends delete envelope without value", () => {
    ds.delete("1");

    expect(sender._posted).toHaveLength(1);
    const msg = lastPosted(sender);
    expect(msg).toEqual({
      $ch: "tsdb:todos",
      p: { t: "d", k: "1" },
    });
  });

  test("batch() sends single batch message with all ops", () => {
    ds.batch((b) => {
      b.insert({ id: "1", text: "A", done: false });
      b.insert({ id: "2", text: "B", done: false });
      b.delete("3");
    });

    expect(sender._posted).toHaveLength(1);
    const msg = lastPosted(sender);
    expect(msg).toEqual({
      $ch: "tsdb:todos",
      p: {
        t: "b",
        ops: [
          { t: "i", k: "1", v: { id: "1", text: "A", done: false } },
          { t: "i", k: "2", v: { id: "2", text: "B", done: false } },
          { t: "d", k: "3" },
        ],
      },
    });
  });

  test("batch() with empty callback sends nothing", () => {
    ds.batch(() => {});

    expect(sender._posted).toHaveLength(0);
  });

  test("sync() sends snapshot of all current items", () => {
    ds.insert({ id: "1", text: "A", done: false });
    ds.insert({ id: "2", text: "B", done: true });
    sender._posted.length = 0; // clear insert messages

    ds.sync();

    expect(sender._posted).toHaveLength(1);
    const msg = lastPosted(sender) as any;
    expect(msg.$ch).toBe("tsdb:todos");
    expect(msg.p.t).toBe("s");
    expect(msg.p.items).toHaveLength(2);
    expect(msg.p.items).toContainEqual({
      k: "1",
      v: { id: "1", text: "A", done: false },
    });
    expect(msg.p.items).toContainEqual({
      k: "2",
      v: { id: "2", text: "B", done: true },
    });
  });

  test("sync(items) replaces internal state and sends snapshot", () => {
    ds.insert({ id: "1", text: "A", done: false });
    sender._posted.length = 0;

    ds.sync([
      { id: "10", text: "X", done: false },
      { id: "20", text: "Y", done: true },
    ]);

    const msg = lastPosted(sender) as any;
    expect(msg.p.t).toBe("s");
    expect(msg.p.items).toHaveLength(2);
    expect(msg.p.items).toContainEqual({
      k: "10",
      v: { id: "10", text: "X", done: false },
    });
    expect(msg.p.items).toContainEqual({
      k: "20",
      v: { id: "20", text: "Y", done: true },
    });
  });

  test("internal map tracks insert/update/delete correctly", () => {
    ds.insert({ id: "1", text: "A", done: false });
    ds.insert({ id: "2", text: "B", done: false });
    ds.delete("1");
    sender._posted.length = 0;

    ds.sync();

    const msg = lastPosted(sender) as any;
    expect(msg.p.items).toHaveLength(1);
    expect(msg.p.items[0]).toEqual({
      k: "2",
      v: { id: "2", text: "B", done: false },
    });
  });

  test("update() replaces item in internal map", () => {
    ds.insert({ id: "1", text: "A", done: false });
    ds.update("1", { id: "1", text: "A updated", done: true });
    sender._posted.length = 0;

    ds.sync();

    const msg = lastPosted(sender) as any;
    expect(msg.p.items).toHaveLength(1);
    expect(msg.p.items[0].v).toEqual({
      id: "1",
      text: "A updated",
      done: true,
    });
  });

  test("getKey is used to derive keys on insert", () => {
    const numDs = createDataSource<{ n: number }, number>(sender, {
      channel: "num",
      getKey: (item) => item.n,
    });
    sender._posted.length = 0;

    numDs.insert({ n: 42 });

    const msg = lastPosted(sender) as any;
    expect(msg.p.k).toBe(42);
  });

  test("batch() update tracks item in internal state", () => {
    ds.batch((b) => {
      b.insert({ id: "1", text: "A", done: false });
      b.update("1", { id: "1", text: "A updated", done: true });
    });
    sender._posted.length = 0;

    ds.sync();

    const msg = lastPosted(sender) as any;
    expect(msg.p.items).toHaveLength(1);
    expect(msg.p.items[0].v.text).toBe("A updated");
  });
});

// ── Webview-side: nativeWindowCollectionOptions ──────────────────

describe("nativeWindowCollectionOptions (fallback path)", () => {
  let originalNativeMessage: any;
  let originalListeners: any;

  beforeEach(() => {
    originalNativeMessage = (window as any).__native_message__;
    originalListeners = (window as any).__native_message_listeners__;
    delete (window as any).__native_message__;
    delete (window as any).__native_message_listeners__;
  });

  // Restore after each test
  afterEach(() => {
    if (originalNativeMessage !== undefined) {
      (window as any).__native_message__ = originalNativeMessage;
    } else {
      delete (window as any).__native_message__;
    }
    if (originalListeners !== undefined) {
      (window as any).__native_message_listeners__ = originalListeners;
    } else {
      delete (window as any).__native_message_listeners__;
    }
  });

  function setupSync() {
    const mock = createMockSyncParams();
    const result = nativeWindowCollectionOptions<Todo, string>({
      id: "todos",
      channel: "tsdb:todos",
      getKey: (todo) => todo.id,
    });
    const cleanup = result.sync.sync(mock.params as any);
    return { result, mock, cleanup };
  }

  function simulate(msg: string): void {
    const handler = (window as any).__native_message__;
    if (handler) handler(msg);
  }

  test("returned config has correct id and getKey", () => {
    const result = nativeWindowCollectionOptions<Todo, string>({
      id: "todos",
      channel: "tsdb:todos",
      getKey: (todo) => todo.id,
    });

    expect(result.id).toBe("todos");
    expect(result.getKey({ id: "abc", text: "x", done: false })).toBe("abc");
  });

  test("insert message triggers begin/write(insert)/commit", () => {
    const { mock } = setupSync();

    simulate(
      JSON.stringify({
        $ch: "tsdb:todos",
        p: { t: "i", k: "1", v: { id: "1", text: "A", done: false } },
      }),
    );

    expect(mock._beginCount).toBe(1);
    expect(mock._commitCount).toBe(1);
    expect(mock._writes).toHaveLength(1);
    expect(mock._writes[0]).toEqual({
      type: "insert",
      value: { id: "1", text: "A", done: false },
    });
  });

  test("update message triggers begin/write(update)/commit", () => {
    const { mock } = setupSync();

    simulate(
      JSON.stringify({
        $ch: "tsdb:todos",
        p: { t: "u", k: "1", v: { id: "1", text: "B", done: true } },
      }),
    );

    expect(mock._beginCount).toBe(1);
    expect(mock._commitCount).toBe(1);
    expect(mock._writes).toHaveLength(1);
    expect(mock._writes[0]).toEqual({
      type: "update",
      value: { id: "1", text: "B", done: true },
    });
  });

  test("delete message triggers begin/write(delete)/commit", () => {
    const { mock } = setupSync();

    simulate(
      JSON.stringify({
        $ch: "tsdb:todos",
        p: { t: "d", k: "1" },
      }),
    );

    expect(mock._beginCount).toBe(1);
    expect(mock._commitCount).toBe(1);
    expect(mock._writes).toHaveLength(1);
    expect(mock._writes[0]).toEqual({
      type: "delete",
      key: "1",
    });
  });

  test("snapshot message calls begin/write(insert) for each item/commit/markReady", () => {
    const { mock } = setupSync();

    simulate(
      JSON.stringify({
        $ch: "tsdb:todos",
        p: {
          t: "s",
          items: [
            { k: "1", v: { id: "1", text: "A", done: false } },
            { k: "2", v: { id: "2", text: "B", done: true } },
          ],
        },
      }),
    );

    expect(mock._beginCount).toBe(1);
    expect(mock._commitCount).toBe(1);
    expect(mock._readyCount).toBe(1);
    expect(mock._writes).toHaveLength(2);
    expect(mock._writes[0]).toEqual({
      type: "insert",
      value: { id: "1", text: "A", done: false },
    });
    expect(mock._writes[1]).toEqual({
      type: "insert",
      value: { id: "2", text: "B", done: true },
    });
  });

  test("batch message applies all ops in single begin/commit", () => {
    const { mock } = setupSync();

    simulate(
      JSON.stringify({
        $ch: "tsdb:todos",
        p: {
          t: "b",
          ops: [
            { t: "i", k: "1", v: { id: "1", text: "A", done: false } },
            { t: "u", k: "2", v: { id: "2", text: "B", done: true } },
            { t: "d", k: "3" },
          ],
        },
      }),
    );

    expect(mock._beginCount).toBe(1);
    expect(mock._commitCount).toBe(1);
    expect(mock._writes).toHaveLength(3);
    expect(mock._writes[0]).toEqual({
      type: "insert",
      value: { id: "1", text: "A", done: false },
    });
    expect(mock._writes[1]).toEqual({
      type: "update",
      value: { id: "2", text: "B", done: true },
    });
    expect(mock._writes[2]).toEqual({
      type: "delete",
      key: "3",
    });
  });

  test("non-matching $ch messages fall through to previous handler", () => {
    const prev = vi.fn();
    (window as any).__native_message__ = prev;

    setupSync();

    const msg = JSON.stringify({
      $ch: "other-channel",
      p: { t: "i", k: "1", v: {} },
    });
    simulate(msg);

    expect(prev).toHaveBeenCalledWith(msg);
  });

  test("invalid JSON falls through to previous handler", () => {
    const prev = vi.fn();
    (window as any).__native_message__ = prev;

    setupSync();

    simulate("not valid json{{{");

    expect(prev).toHaveBeenCalledWith("not valid json{{{");
  });

  test("non-envelope messages fall through to previous handler", () => {
    const prev = vi.fn();
    (window as any).__native_message__ = prev;

    setupSync();

    const msg = JSON.stringify({ foo: "bar" });
    simulate(msg);

    expect(prev).toHaveBeenCalledWith(msg);
  });

  test("cleanup function restores original __native_message__", () => {
    const prev = vi.fn();
    (window as any).__native_message__ = prev;

    const { cleanup } = setupSync();

    // After setup, handler should be replaced
    expect((window as any).__native_message__).not.toBe(prev);

    cleanup();

    // After cleanup, handler should be restored
    expect((window as any).__native_message__).toBe(prev);
  });

  test("cleanup restores undefined when no previous handler existed", () => {
    const { cleanup } = setupSync();

    cleanup();

    expect((window as any).__native_message__).toBeUndefined();
  });

  test("messages with missing payload fall through", () => {
    const prev = vi.fn();
    (window as any).__native_message__ = prev;

    setupSync();

    const msg = JSON.stringify({ $ch: "tsdb:todos" });
    simulate(msg);

    expect(prev).toHaveBeenCalledWith(msg);
  });

  test("messages with invalid payload type fall through", () => {
    const prev = vi.fn();
    (window as any).__native_message__ = prev;

    setupSync();

    const msg = JSON.stringify({ $ch: "tsdb:todos", p: "not-an-object" });
    simulate(msg);

    expect(prev).toHaveBeenCalledWith(msg);
  });
});

// ── Webview-side: listener registry path ────────────────────────

describe("nativeWindowCollectionOptions (listener registry path)", () => {
  let originalNativeMessage: any;
  let originalListeners: any;
  let registeredHandlers: Array<(msg: string) => void>;
  let registry: { add(fn: (msg: string) => void): void; remove(fn: (msg: string) => void): void };

  beforeEach(() => {
    originalNativeMessage = (window as any).__native_message__;
    originalListeners = (window as any).__native_message_listeners__;
    // Simulate the IPC client having been initialised: expose a frozen
    // { add, remove } registry just like the hardened createChannelClient does.
    registeredHandlers = [];
    registry = {
      add(fn: (msg: string) => void): void {
        if (typeof fn === "function") registeredHandlers.push(fn);
      },
      remove(fn: (msg: string) => void): void {
        const idx = registeredHandlers.indexOf(fn);
        if (idx !== -1) registeredHandlers.splice(idx, 1);
      },
    };
    (window as any).__native_message_listeners__ = registry;
  });

  afterEach(() => {
    if (originalNativeMessage !== undefined) {
      (window as any).__native_message__ = originalNativeMessage;
    } else {
      delete (window as any).__native_message__;
    }
    if (originalListeners !== undefined) {
      (window as any).__native_message_listeners__ = originalListeners;
    } else {
      delete (window as any).__native_message_listeners__;
    }
  });

  function setupSync() {
    const mock = createMockSyncParams();
    const result = nativeWindowCollectionOptions<Todo, string>({
      id: "todos",
      channel: "tsdb:todos",
      getKey: (todo) => todo.id,
    });
    const cleanup = result.sync.sync(mock.params as any);
    return { result, mock, cleanup };
  }

  /** Dispatch a message through all registered external listeners. */
  function simulate(msg: string): void {
    for (const fn of registeredHandlers) fn(msg);
  }

  test("handler is registered via registry.add()", () => {
    setupSync();
    expect(registeredHandlers).toHaveLength(1);
    expect(typeof registeredHandlers[0]).toBe("function");
  });

  test("insert message is processed via listener registry", () => {
    const { mock } = setupSync();

    simulate(
      JSON.stringify({
        $ch: "tsdb:todos",
        p: { t: "i", k: "1", v: { id: "1", text: "A", done: false } },
      }),
    );

    expect(mock._writes).toHaveLength(1);
    expect(mock._writes[0]).toEqual({
      type: "insert",
      value: { id: "1", text: "A", done: false },
    });
  });

  test("snapshot message calls markReady via listener registry", () => {
    const { mock } = setupSync();

    simulate(
      JSON.stringify({
        $ch: "tsdb:todos",
        p: {
          t: "s",
          items: [
            { k: "1", v: { id: "1", text: "A", done: false } },
            { k: "2", v: { id: "2", text: "B", done: true } },
          ],
        },
      }),
    );

    expect(mock._readyCount).toBe(1);
    expect(mock._writes).toHaveLength(2);
  });

  test("batch message is processed via listener registry", () => {
    const { mock } = setupSync();

    simulate(
      JSON.stringify({
        $ch: "tsdb:todos",
        p: {
          t: "b",
          ops: [
            { t: "i", k: "1", v: { id: "1", text: "A", done: false } },
            { t: "d", k: "2" },
          ],
        },
      }),
    );

    expect(mock._beginCount).toBe(1);
    expect(mock._commitCount).toBe(1);
    expect(mock._writes).toHaveLength(2);
  });

  test("messages for other channels are silently ignored", () => {
    const { mock } = setupSync();

    simulate(
      JSON.stringify({
        $ch: "other-channel",
        p: { t: "i", k: "1", v: {} },
      }),
    );

    expect(mock._writes).toHaveLength(0);
  });

  test("cleanup removes handler via registry.remove()", () => {
    const { cleanup } = setupSync();
    expect(registeredHandlers).toHaveLength(1);

    cleanup();
    expect(registeredHandlers).toHaveLength(0);
  });

  test("does not touch __native_message__ when listener registry is available", () => {
    const prev = vi.fn();
    (window as any).__native_message__ = prev;

    setupSync();

    // __native_message__ should remain the same fn (not overwritten)
    expect((window as any).__native_message__).toBe(prev);
  });
});

// ── Integration: host → webview round-trip ───────────────────────

describe("host → webview round-trip", () => {
  let originalNativeMessage: any;
  let originalListeners: any;

  beforeEach(() => {
    originalNativeMessage = (window as any).__native_message__;
    originalListeners = (window as any).__native_message_listeners__;
    delete (window as any).__native_message__;
    delete (window as any).__native_message_listeners__;
  });

  afterEach(() => {
    if (originalNativeMessage !== undefined) {
      (window as any).__native_message__ = originalNativeMessage;
    } else {
      delete (window as any).__native_message__;
    }
    if (originalListeners !== undefined) {
      (window as any).__native_message_listeners__ = originalListeners;
    } else {
      delete (window as any).__native_message_listeners__;
    }
  });

  test("insert on host is received as insert on webview", () => {
    const mock = createMockSyncParams();
    const result = nativeWindowCollectionOptions<Todo, string>({
      id: "todos",
      channel: "tsdb:todos",
      getKey: (todo) => todo.id,
    });
    result.sync.sync(mock.params as any);

    // Create a sender that delivers to __native_message__
    const sender: MessageSender = {
      postMessage(msg: string): void {
        const handler = (window as any).__native_message__;
        handler?.(msg);
      },
    };

    const ds = createDataSource<Todo, string>(sender, {
      channel: "tsdb:todos",
      getKey: (todo) => todo.id,
    });

    ds.insert({ id: "1", text: "Hello", done: false });

    expect(mock._writes).toHaveLength(1);
    expect(mock._writes[0]).toEqual({
      type: "insert",
      value: { id: "1", text: "Hello", done: false },
    });
  });

  test("sync() snapshot on host triggers markReady on webview", () => {
    const mock = createMockSyncParams();
    const result = nativeWindowCollectionOptions<Todo, string>({
      id: "todos",
      channel: "tsdb:todos",
      getKey: (todo) => todo.id,
    });
    result.sync.sync(mock.params as any);

    const sender: MessageSender = {
      postMessage(msg: string): void {
        const handler = (window as any).__native_message__;
        handler?.(msg);
      },
    };

    const ds = createDataSource<Todo, string>(sender, {
      channel: "tsdb:todos",
      getKey: (todo) => todo.id,
    });

    ds.insert({ id: "1", text: "A", done: false });
    ds.insert({ id: "2", text: "B", done: true });
    ds.sync();

    // 2 inserts + 1 snapshot (with 2 writes)
    expect(mock._writes).toHaveLength(4);
    expect(mock._readyCount).toBe(1);
  });

  test("batch on host is applied atomically on webview", () => {
    const mock = createMockSyncParams();
    const result = nativeWindowCollectionOptions<Todo, string>({
      id: "todos",
      channel: "tsdb:todos",
      getKey: (todo) => todo.id,
    });
    result.sync.sync(mock.params as any);

    const sender: MessageSender = {
      postMessage(msg: string): void {
        const handler = (window as any).__native_message__;
        handler?.(msg);
      },
    };

    const ds = createDataSource<Todo, string>(sender, {
      channel: "tsdb:todos",
      getKey: (todo) => todo.id,
    });

    ds.batch((b) => {
      b.insert({ id: "1", text: "A", done: false });
      b.insert({ id: "2", text: "B", done: false });
      b.delete("3");
    });

    // One begin/commit for the batch
    expect(mock._beginCount).toBe(1);
    expect(mock._commitCount).toBe(1);
    expect(mock._writes).toHaveLength(3);
  });

  test("multiple data sources on different channels are independent", () => {
    const mock1 = createMockSyncParams();
    const mock2 = createMockSyncParams();

    const result1 = nativeWindowCollectionOptions<Todo, string>({
      id: "todos",
      channel: "tsdb:todos",
      getKey: (todo) => todo.id,
    });
    const cleanup1 = result1.sync.sync(mock1.params as any);

    const result2 = nativeWindowCollectionOptions<Todo, string>({
      id: "notes",
      channel: "tsdb:notes",
      getKey: (note) => note.id,
    });
    const cleanup2 = result2.sync.sync(mock2.params as any);

    const sender: MessageSender = {
      postMessage(msg: string): void {
        const handler = (window as any).__native_message__;
        handler?.(msg);
      },
    };

    const ds1 = createDataSource<Todo, string>(sender, {
      channel: "tsdb:todos",
      getKey: (todo) => todo.id,
    });
    const ds2 = createDataSource<Todo, string>(sender, {
      channel: "tsdb:notes",
      getKey: (note) => note.id,
    });

    ds1.insert({ id: "1", text: "Todo", done: false });
    ds2.insert({ id: "2", text: "Note", done: true });

    expect(mock1._writes).toHaveLength(1);
    expect(mock1._writes[0]!.value).toEqual({
      id: "1",
      text: "Todo",
      done: false,
    });

    expect(mock2._writes).toHaveLength(1);
    expect(mock2._writes[0]!.value).toEqual({
      id: "2",
      text: "Note",
      done: true,
    });

    cleanup1();
    cleanup2();
  });
});
