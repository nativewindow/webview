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

/** @internal IPC envelope structure (`{ $ch, p }`). */
interface Envelope {
  $ch: string;
  p: unknown;
}

// ── Public types ─────────────────────────────────────────────────

/**
 * Options for {@link nativeWindowCollectionOptions}.
 *
 * @example
 * ```ts
 * import { createCollection } from "@tanstack/db";
 * import { nativeWindowCollectionOptions } from "@nativewindow/tsdb/client";
 *
 * const todos = createCollection(
 *   nativeWindowCollectionOptions<Todo, string>({
 *     id: "todos",
 *     channel: "tsdb:todos",
 *     getKey: (todo) => todo.id,
 *   }),
 * );
 * ```
 */
export interface NativeWindowCollectionConfig<T extends object, TKey extends string | number> {
  /** Collection ID for TanStack DB. */
  id: string;
  /**
   * IPC channel name. Must match the `channel` passed to
   * `createDataSource` on the host side.
   */
  channel: string;
  /** Extract the primary key from an item. */
  getKey: (item: T) => TKey;
}

/**
 * Sync parameters provided by TanStack DB's `createCollection`.
 * Declared locally to avoid a runtime dependency on `@tanstack/db`.
 * @internal
 */
interface SyncParams<T extends object, TKey extends string | number> {
  collection: unknown;
  begin: (options?: { immediate?: boolean }) => void;
  write: (
    message:
      | {
          value: T;
          type: "insert" | "update" | "delete";
          previousValue?: T;
          metadata?: Record<string, unknown>;
        }
      | { key: TKey; type: "delete" },
  ) => void;
  commit: () => void;
  markReady: () => void;
  truncate: () => void;
}

/**
 * Return type of {@link nativeWindowCollectionOptions}.
 * Structurally compatible with `CollectionConfig` from `@tanstack/db`.
 */
export interface NativeWindowCollectionResult<T extends object, TKey extends string | number> {
  id: string;
  getKey: (item: T) => TKey;
  sync: {
    sync: (params: SyncParams<T, TKey>) => () => void;
  };
}

// ── Helpers ──────────────────────────────────────────────────────

/** @internal Type guard for IPC envelope. */
function isEnvelope(data: unknown): data is Envelope {
  return (
    typeof data === "object" &&
    data !== null &&
    "$ch" in data &&
    typeof (data as Envelope).$ch === "string"
  );
}

// ── Factory ──────────────────────────────────────────────────────

/**
 * Create TanStack DB collection options that sync data from a
 * native-window host process via IPC.
 *
 * The returned config is **read-only** — no `onInsert`/`onUpdate`/
 * `onDelete` handlers. Data flows host to webview only.
 *
 * The sync function prefers `window.__native_message_listeners__`
 * (the external listener registry exposed by `createChannelClient`)
 * when available. This avoids the frozen-property crash caused by
 * assigning to the read-only `window.__native_message__`. When the
 * IPC client is not present, it falls back to direct interposition
 * of `window.__native_message__` with a try/catch guard.
 *
 * @param config - Collection and channel configuration.
 * @returns An object compatible with `createCollection()` from `@tanstack/db`.
 *
 * @example
 * ```ts
 * import { createCollection } from "@tanstack/db";
 * import { useLiveQuery } from "@tanstack/react-db";
 * import { nativeWindowCollectionOptions } from "@nativewindow/tsdb/client";
 *
 * type Todo = { id: string; text: string; done: boolean };
 *
 * const todoCollection = createCollection(
 *   nativeWindowCollectionOptions<Todo, string>({
 *     id: "todos",
 *     channel: "tsdb:todos",
 *     getKey: (todo) => todo.id,
 *   }),
 * );
 *
 * function TodoList() {
 *   const { data: todos } = useLiveQuery((q) =>
 *     q.from({ todos: todoCollection }),
 *   );
 *   return (
 *     <ul>
 *       {todos.map((todo) => (
 *         <li key={todo.id}>{todo.text}</li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 */
export function nativeWindowCollectionOptions<
  T extends object,
  TKey extends string | number = string,
>(config: NativeWindowCollectionConfig<T, TKey>): NativeWindowCollectionResult<T, TKey> {
  const { id, channel, getKey } = config;

  return {
    id,
    getKey,
    sync: {
      sync: (params: SyncParams<T, TKey>): (() => void) => {
        const { begin, write, commit, markReady } = params;

        function processPayload(payload: SyncPayload<T, TKey>): void {
          switch (payload.t) {
            case "i":
              begin();
              write({ type: "insert", value: payload.v });
              commit();
              break;

            case "u":
              begin();
              write({ type: "update", value: payload.v });
              commit();
              break;

            case "d":
              begin();
              write({ key: payload.k, type: "delete" });
              commit();
              break;

            case "s":
              // Full snapshot: insert all items then mark ready
              begin();
              for (const item of payload.items) {
                write({ type: "insert", value: item.v });
              }
              commit();
              markReady();
              break;

            case "b":
              // Batch: apply all ops in one transaction
              begin();
              for (const op of payload.ops) {
                switch (op.t) {
                  case "i":
                    write({ type: "insert", value: op.v });
                    break;
                  case "u":
                    write({ type: "update", value: op.v });
                    break;
                  case "d":
                    write({ key: op.k, type: "delete" });
                    break;
                }
              }
              commit();
              break;
          }
        }

        /** Handler that filters for our channel and dispatches. */
        function handler(msg: string): void {
          let parsed: unknown;
          try {
            parsed = JSON.parse(msg);
          } catch {
            return;
          }

          if (!isEnvelope(parsed) || parsed.$ch !== channel) return;

          const payload = parsed.p as SyncPayload<T, TKey> | undefined;
          if (!payload || typeof payload.t !== "string") return;

          processPayload(payload);
        }

        // Prefer the external listener registry exposed by the IPC client.
        // When createChannelClient has been initialised it freezes
        // __native_message__ and exposes __native_message_listeners__ as
        // a frozen { add, remove } object for third-party handlers.
        const registry = (window as any).__native_message_listeners__ as
          | { add(fn: (msg: string) => void): void; remove(fn: (msg: string) => void): void }
          | undefined;

        if (registry && typeof registry.add === "function") {
          registry.add(handler);

          return (): void => {
            registry.remove(handler);
          };
        }

        // Fallback: interpose on __native_message__ directly.
        // Wrapped in try/catch because the property may have been frozen
        // by a prior createChannelClient call.
        const prev = (window as any).__native_message__ as ((msg: string) => void) | undefined;

        function fallbackHandler(msg: string): void {
          let parsed: unknown;
          try {
            parsed = JSON.parse(msg);
          } catch {
            prev?.(msg);
            return;
          }

          if (!isEnvelope(parsed) || parsed.$ch !== channel) {
            prev?.(msg);
            return;
          }

          const payload = parsed.p as SyncPayload<T, TKey> | undefined;
          if (!payload || typeof payload.t !== "string") {
            prev?.(msg);
            return;
          }

          processPayload(payload);
        }

        try {
          (window as any).__native_message__ = fallbackHandler;
        } catch {
          // Property is frozen — cannot install handler
        }

        return (): void => {
          try {
            if ((window as any).__native_message__ === fallbackHandler) {
              (window as any).__native_message__ = prev;
            }
          } catch {
            // Property is frozen — cannot restore
          }
        };
      },
    },
  };
}
