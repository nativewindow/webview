# Skill: @nativewindow/tsdb

Use this skill when working on the **TanStack DB collection adapter** (`packages/tsdb`). This package provides a host-to-webview data synchronization layer that integrates with TanStack DB's `createCollection()` API via native-window IPC.

## Package Identity

- **npm name:** `@nativewindow/tsdb`
- **Location:** `packages/tsdb/`
- **Language:** Pure TypeScript — **zero runtime dependencies**
- **Exports:** `@nativewindow/tsdb` (host-side) and `@nativewindow/tsdb/client` (webview-side)
- **Peer deps:** `@nativewindow/webview`, `typescript`

## Architecture

### Data Flow

Data flows **host → webview only** (read-only on the client). The host maintains an internal `Map<TKey, T>` of all items and pushes mutations to the webview via IPC. The webview side translates IPC messages into TanStack DB `begin/write/commit` operations.

```
Host (Node/Bun)                      Webview (Browser)
┌──────────────┐   IPC postMessage   ┌──────────────────────┐
│ DataSource   │ ──────────────────→ │ TanStack DB          │
│ insert/update│   {$ch, p} JSON     │ createCollection()   │
│ delete/batch │                      │ begin/write/commit   │
│ sync         │                      │ useLiveQuery()       │
└──────────────┘                      └──────────────────────┘
```

### Wire Protocol

All messages use the standard `{$ch, p}` IPC envelope. The `$ch` value is the `channel` string from config.

#### Operation types (`p.t`):

| Type | Name | Payload |
|------|------|---------|
| `"i"` | Insert | `{ t: "i", k: TKey, v: T }` |
| `"u"` | Update | `{ t: "u", k: TKey, v: T }` |
| `"d"` | Delete | `{ t: "d", k: TKey }` |
| `"s"` | Snapshot | `{ t: "s", items: Array<{ k: TKey, v: T }> }` |
| `"b"` | Batch | `{ t: "b", ops: Array<SyncOp> }` |

## File Structure

```
packages/tsdb/
  index.ts        # Host-side: createDataSource, DataSource, BatchBuilder
  client.ts       # Webview-side: nativeWindowCollectionOptions (TanStack DB adapter)
  tests/
    sync.test.ts  # Unit tests (vitest)
```

## Key Types & Exports

### Host-side (`index.ts`)

```ts
// Minimal interface — works with NativeWindow without importing it
interface MessageSender {
  postMessage(message: string): void;
}

interface DataSourceOptions<T extends object, TKey extends string | number> {
  channel: string;                    // Must match client-side channel
  getKey: (item: T) => TKey;          // Primary key extractor
}

interface BatchBuilder<T, TKey> {
  insert(item: T): void;
  update(key: TKey, item: T): void;
  delete(key: TKey): void;
}

interface DataSource<T, TKey> {
  insert(item: T): void;
  update(key: TKey, item: T): void;
  delete(key: TKey): void;
  batch(fn: (builder: BatchBuilder<T, TKey>) => void): void;
  sync(items?: T[]): void;           // Send full snapshot (or replace + send)
}

function createDataSource<T, TKey = string>(
  sender: MessageSender,
  options: DataSourceOptions<T, TKey>,
): DataSource<T, TKey>;
```

### Client-side (`client.ts`)

```ts
interface NativeWindowCollectionConfig<T, TKey> {
  id: string;                         // Collection ID for TanStack DB
  channel: string;                    // Must match host-side channel
  getKey: (item: T) => TKey;
}

interface NativeWindowCollectionResult<T, TKey> {
  id: string;
  getKey: (item: T) => TKey;
  sync: { sync: (params: SyncParams) => () => void };
}

function nativeWindowCollectionOptions<T, TKey = string>(
  config: NativeWindowCollectionConfig<T, TKey>,
): NativeWindowCollectionResult<T, TKey>;
```

## Usage Patterns

### Host-side (Node/Bun process)

```ts
import { NativeWindow } from "@nativewindow/webview";
import { createDataSource } from "@nativewindow/tsdb";

type Todo = { id: string; text: string; done: boolean };

const win = new NativeWindow({ title: "My App" });
win.loadUrl("http://localhost:5173");

const todos = createDataSource<Todo, string>(win, {
  channel: "tsdb:todos",
  getKey: (todo) => todo.id,
});

// Individual mutations
todos.insert({ id: "1", text: "Buy milk", done: false });
todos.update("1", { id: "1", text: "Buy oat milk", done: false });
todos.delete("1");

// Batch operations (single IPC message)
todos.batch((b) => {
  b.insert({ id: "2", text: "A", done: false });
  b.insert({ id: "3", text: "B", done: false });
  b.delete("1");
});

// Re-send full state after page load
win.onPageLoad((event) => {
  if (event === "finished") todos.sync();
});

// Replace internal state and sync
todos.sync([
  { id: "1", text: "A", done: false },
  { id: "2", text: "B", done: true },
]);
```

### Client-side (React webview app)

```tsx
import { createCollection } from "@tanstack/db";
import { useLiveQuery } from "@tanstack/react-db";
import { nativeWindowCollectionOptions } from "@nativewindow/tsdb/client";

type Todo = { id: string; text: string; done: boolean };

const todoCollection = createCollection(
  nativeWindowCollectionOptions<Todo, string>({
    id: "todos",
    channel: "tsdb:todos",
    getKey: (todo) => todo.id,
  }),
);

function TodoList() {
  const { data: todos } = useLiveQuery((q) =>
    q.from({ todos: todoCollection }),
  );
  return (
    <ul>
      {todos.map((todo) => (
        <li key={todo.id}>{todo.text}</li>
      ))}
    </ul>
  );
}
```

## Client-side IPC Integration

The client-side sync function uses two strategies (in order of preference):

1. **`window.__native_message_listeners__`** (preferred): The external listener registry exposed by `createChannelClient` from `@nativewindow/ipc/client`. Non-destructive — registers via `add(handler)`.
2. **`window.__native_message__` interposition** (fallback): Direct interposition of the message handler. Wrapped in `try/catch` because the property may be frozen by a prior `createChannelClient` call.

The cleanup function returned by `sync()` properly unregisters the handler from either mechanism.

## Internal State Management

The `DataSource` maintains an internal `Map<TKey, T>` that mirrors the current state:
- `insert()` / `update()`: Sets the item in the map AND sends an IPC message.
- `delete()`: Removes from the map AND sends an IPC message.
- `batch()`: Applies all ops to the map AND sends a single batch IPC message.
- `sync()`: Optionally replaces the internal map, then sends a full snapshot.

This design allows `sync()` to re-send the full state after page reloads without needing external state tracking.

## Testing

- **Framework:** vitest
- **Test file:** `packages/tsdb/tests/sync.test.ts`
- **Run all:** `vitest run` in `packages/tsdb`
- **Run single:** `vitest run -t "pattern"`

### Mock Patterns

```ts
// Mock sender (host-side)
function createMockSender(): MessageSender & { _posted: string[] } {
  const posted: string[] = [];
  return {
    postMessage(msg) { posted.push(msg); },
    _posted: posted,
  };
}

// Mock TanStack DB sync params (client-side)
function createMockSyncParams() {
  const writes: Array<Record<string, unknown>> = [];
  let beginCount = 0, commitCount = 0, readyCount = 0;
  return {
    params: {
      collection: {},
      begin: () => { beginCount++; },
      write: (msg) => { writes.push(msg); },
      commit: () => { commitCount++; },
      markReady: () => { readyCount++; },
      truncate: () => {},
    },
    _writes: writes,
    get _beginCount() { return beginCount; },
    get _commitCount() { return commitCount; },
    get _readyCount() { return readyCount; },
  };
}
```

## Adding Features — Checklist

1. **Implement** in `packages/tsdb/index.ts` (host) and/or `client.ts` (webview).
2. **Keep pure TypeScript** — no runtime dependencies, no native imports.
3. **Maintain protocol compatibility:** Both sides must agree on `$ch` channel name and `p.t` operation types.
4. **Host side:** Uses `MessageSender` interface (not `NativeWindow` directly) for testability.
5. **Client side:** Must work both WITH and WITHOUT `createChannelClient` (uses fallback interposition).
6. **Add tests** in `tests/sync.test.ts`.
7. If adding new operation types, add both encode (host) and decode (client) paths.

## Code Style Reminders

- `import type` for type-only imports.
- Named exports only — no default exports.
- 2-space indentation, double quotes, semicolons.
- JSDoc `/** */` with `@example` on all public exports.
- `@internal` tag on private implementation details.
