// ── Wire protocol types ──────────────────────────────────────────

/** @internal Single sync operation (insert, update, or delete). */
type SyncOp<T extends object, TKey extends string | number> =
  | { t: "i"; k: TKey; v: T }
  | { t: "u"; k: TKey; v: T }
  | { t: "d"; k: TKey };

/** @internal Sync message payload sent from host to webview. */
type SyncPayload<T extends object, TKey extends string | number> =
  | SyncOp<T, TKey>
  | { t: "s"; items: Array<{ k: TKey; v: T }> }
  | { t: "b"; ops: Array<SyncOp<T, TKey>> };

// ── Public types ─────────────────────────────────────────────────

/**
 * Minimal interface for sending messages to the webview.
 * Satisfied by {@link NativeWindow} without importing it directly.
 *
 * @example
 * ```ts
 * const win = new NativeWindow();
 * // win satisfies MessageSender
 * ```
 */
export interface MessageSender {
  postMessage(message: string): void;
}

/**
 * Options for {@link createDataSource}.
 *
 * @example
 * ```ts
 * const ds = createDataSource<Todo, string>(win, {
 *   channel: "tsdb:todos",
 *   getKey: (todo) => todo.id,
 * });
 * ```
 */
export interface DataSourceOptions<T extends object, TKey extends string | number> {
  /**
   * IPC channel name for this data source.
   * Must match the `channel` passed to `nativeWindowCollectionOptions`
   * on the webview side.
   */
  channel: string;
  /** Extract the primary key from an item. */
  getKey: (item: T) => TKey;
}

/**
 * Builder for batched operations passed to {@link DataSource.batch}.
 *
 * @example
 * ```ts
 * ds.batch((b) => {
 *   b.insert({ id: "1", text: "A", done: false });
 *   b.insert({ id: "2", text: "B", done: false });
 *   b.delete("3");
 * });
 * ```
 */
export interface BatchBuilder<T extends object, TKey extends string | number> {
  /** Queue an insert operation. */
  insert(item: T): void;
  /** Queue a full-item update operation. */
  update(key: TKey, item: T): void;
  /** Queue a delete operation. */
  delete(key: TKey): void;
}

/**
 * A host-side data source that pushes mutations to the webview
 * via native-window IPC. Data flows host to webview only.
 *
 * Each mutation updates an internal item map *and* sends an IPC
 * message so the webview collection stays in sync.
 *
 * @example
 * ```ts
 * const ds = createDataSource<Todo, string>(win, {
 *   channel: "tsdb:todos",
 *   getKey: (todo) => todo.id,
 * });
 *
 * ds.insert({ id: "1", text: "Buy milk", done: false });
 * ds.update("1", { id: "1", text: "Buy oat milk", done: false });
 * ds.delete("1");
 * ```
 */
export interface DataSource<T extends object, TKey extends string | number> {
  /** Send an insert to the webview and track the item internally. */
  insert(item: T): void;
  /** Send a full-item update to the webview and update internal state. */
  update(key: TKey, item: T): void;
  /** Send a delete to the webview and remove the item internally. */
  delete(key: TKey): void;
  /**
   * Execute multiple operations as a single IPC message.
   * The webview applies them atomically within one begin/commit cycle.
   *
   * @example
   * ```ts
   * ds.batch((b) => {
   *   b.insert({ id: "1", text: "A", done: false });
   *   b.insert({ id: "2", text: "B", done: false });
   *   b.delete("3");
   * });
   * ```
   */
  batch(fn: (builder: BatchBuilder<T, TKey>) => void): void;
  /**
   * Send the current internal state as a full snapshot to the webview.
   * If `items` is provided, replaces the internal state first.
   *
   * Call this after page load to initialize or re-initialize the
   * webview collection (e.g. from an `onPageLoad` handler).
   *
   * @example
   * ```ts
   * // Send current state
   * ds.sync();
   *
   * // Replace internal state and send
   * ds.sync([
   *   { id: "1", text: "A", done: false },
   *   { id: "2", text: "B", done: true },
   * ]);
   * ```
   */
  sync(items?: T[]): void;
}

// ── Factory ──────────────────────────────────────────────────────

/**
 * Create a host-side data source that pushes mutations to the
 * webview via native-window IPC.
 *
 * The data source maintains an internal `Map` of all items so it
 * can send full snapshots on demand (e.g. after a page reload).
 * Individual mutations (`insert`, `update`, `delete`) update the
 * map *and* send an incremental IPC message.
 *
 * @param sender - Any object with a `postMessage` method (e.g. a `NativeWindow`).
 * @param options - Data source configuration.
 * @returns A {@link DataSource} with imperative push methods.
 *
 * @example
 * ```ts
 * import { NativeWindow } from "@nativewindow/webview";
 * import { createDataSource } from "@nativewindow/tsdb";
 *
 * const win = new NativeWindow({ title: "My App" });
 * win.loadUrl("http://localhost:5173");
 *
 * const todos = createDataSource<Todo, string>(win, {
 *   channel: "tsdb:todos",
 *   getKey: (todo) => todo.id,
 * });
 *
 * todos.insert({ id: "1", text: "Hello", done: false });
 *
 * // Re-send full state after page load
 * win.onPageLoad((event) => {
 *   if (event === "finished") todos.sync();
 * });
 * ```
 */
export function createDataSource<T extends object, TKey extends string | number = string>(
  sender: MessageSender,
  options: DataSourceOptions<T, TKey>,
): DataSource<T, TKey> {
  const { channel, getKey } = options;
  const items = new Map<TKey, T>();

  // -- helpers ----

  function send(payload: SyncPayload<T, TKey>): void {
    sender.postMessage(JSON.stringify({ $ch: channel, p: payload }));
  }

  function sendSnapshot(): void {
    const entries: Array<{ k: TKey; v: T }> = [];
    items.forEach((v, k) => entries.push({ k, v }));
    send({ t: "s", items: entries });
  }

  // -- public API ----

  return {
    insert(item: T): void {
      const key = getKey(item);
      items.set(key, item);
      send({ t: "i", k: key, v: item });
    },

    update(key: TKey, item: T): void {
      items.set(key, item);
      send({ t: "u", k: key, v: item });
    },

    delete(key: TKey): void {
      items.delete(key);
      send({ t: "d", k: key });
    },

    batch(fn: (builder: BatchBuilder<T, TKey>) => void): void {
      const ops: Array<SyncOp<T, TKey>> = [];

      const builder: BatchBuilder<T, TKey> = {
        insert(item: T): void {
          const key = getKey(item);
          items.set(key, item);
          ops.push({ t: "i", k: key, v: item });
        },
        update(key: TKey, item: T): void {
          items.set(key, item);
          ops.push({ t: "u", k: key, v: item });
        },
        delete(key: TKey): void {
          items.delete(key);
          ops.push({ t: "d", k: key });
        },
      };

      fn(builder);
      if (ops.length > 0) send({ t: "b", ops });
    },

    sync(newItems?: T[]): void {
      if (newItems !== undefined) {
        items.clear();
        for (const item of newItems) {
          items.set(getKey(item), item);
        }
      }
      sendSnapshot();
    },
  };
}
