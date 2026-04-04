# Skill: @nativewindow/react

Use this skill when working on the **React bindings** (`packages/react`). This package provides React hooks and context providers for the native-window typed IPC channel, designed for use inside a webview running a React app.

## Package Identity

- **npm name:** `@nativewindow/react`
- **Location:** `packages/react/`
- **Language:** Pure TypeScript (React hooks)
- **Peer deps:** `@nativewindow/ipc`, `react ^18 || ^19`, `typescript`
- **Runs in:** Webview (browser) context — NOT the host process

## Architecture

This package wraps `createChannelClient` from `@nativewindow/ipc/client` into React-friendly hooks with context and lifecycle management.

### Two Usage Approaches

1. **Generic hooks** (`ChannelProvider`, `useChannel`, `useChannelEvent`, `useSend`) — require manual generic type parameters at call sites.
2. **Factory hooks via `createChannelHooks()`** (recommended) — schemas infer all types automatically. Each call creates its own React context, supporting multiple independent channels.

## File Structure

```
packages/react/
  index.ts        # All hooks, providers, and types
  tests/
    hooks.test.ts # Unit tests (vitest + @testing-library/react + jsdom)
```

## Key Exports

### Types (re-exported from `@nativewindow/ipc`)

```ts
export type {
  EventMap, SchemaLike, SchemaMap, InferSchemaMap,
  InferOutput, SendArgs, ValidationErrorHandler, TypedChannel,
} from "@nativewindow/ipc";

export type { ChannelClientOptions } from "@nativewindow/ipc/client";
```

### Generic Approach

```ts
// Provider
interface ChannelProviderProps<H extends SchemaMap, C extends SchemaMap> {
  schemas: { host: H; client: C };
  onValidationError?: ValidationErrorHandler;
  children: ReactNode;
}
function ChannelProvider<H, C>(props: ChannelProviderProps<H, C>): ReactNode;

// Hooks
function useChannel<Send, Receive>(): TypedChannel<Send, Receive>;
function useChannelEvent<Receive, K>(type: K, handler: (payload: Receive[K]) => void): void;
function useSend<Send>(): <K>(...args: SendArgs<Send, K>) => void;
```

### Factory Approach (Recommended)

```ts
interface ChannelHooksOptions {
  onValidationError?: ValidationErrorHandler;
}

interface TypedChannelHooks<Send, Receive> {
  ChannelProvider: (props: { children: ReactNode }) => ReactNode;
  useChannel: () => TypedChannel<Send, Receive>;
  useChannelEvent: <K>(type: K, handler: (payload: Receive[K]) => void) => void;
  useSend: () => <K>(...args: SendArgs<Send, K>) => void;
}

function createChannelHooks<H, C>(
  schemas: { host: H; client: C },
  options?: ChannelHooksOptions,
): TypedChannelHooks<InferSchemaMap<C>, InferSchemaMap<H>>;
```

## Usage Patterns

### Factory Approach (Recommended)

```tsx
import { z } from "zod";
import { createChannelHooks } from "@nativewindow/react";

// All types inferred from schemas — no generic params needed
const { ChannelProvider, useChannel, useChannelEvent, useSend } =
  createChannelHooks({
    host: { title: z.string() },
    client: { counter: z.number() },
  });

function App() {
  const send = useSend();
  useChannelEvent("title", (t) => { document.title = t; }); // t: string
  return <button onClick={() => send("counter", 1)}>+1</button>;
}

function Root() {
  return (
    <ChannelProvider>
      <App />
    </ChannelProvider>
  );
}
```

### Generic Approach

```tsx
import { z } from "zod";
import { ChannelProvider, useChannel, useChannelEvent, useSend } from "@nativewindow/react";

const schemas = {
  host: { title: z.string() },
  client: { counter: z.number() },
};

type ClientEvents = { counter: number };
type HostEvents = { title: string };

function App() {
  const send = useSend<ClientEvents>();
  useChannelEvent<HostEvents, "title">("title", (t) => { document.title = t; });
  return <button onClick={() => send("counter", 1)}>+1</button>;
}

function Root() {
  return (
    <ChannelProvider schemas={schemas}>
      <App />
    </ChannelProvider>
  );
}
```

## Hook Implementation Details

### ChannelProvider
- Creates the channel client **exactly once** on initial mount (via `useRef`).
- Channel instance is stable for the lifetime of the provider.
- Calls `createChannelClient()` from `@nativewindow/ipc/client`.

### useChannel
- Reads the channel from React context.
- **Throws** if called outside a `ChannelProvider`.

### useChannelEvent
- Stores handler in a `useRef` to avoid re-subscribing when handler identity changes.
- The subscription itself only re-runs when `type` changes.
- Automatically cleans up (`off()`) on unmount.

### useSend
- Returns a **stable** send function via `useCallback` bound to the channel instance.
- Does not change between renders.

## Direction Mapping

The direction mapping is the **inverse** of the host side:

| Side | `send()` uses | `on()`/`off()` uses |
|------|--------------|---------------------|
| Host (`createChannel`) | `host` schemas | `client` schemas |
| Client (`createChannelClient` / React) | `client` schemas | `host` schemas |

In the React hooks, `Send = InferSchemaMap<C>` (client events) and `Receive = InferSchemaMap<H>` (host events).

## Testing

- **Framework:** vitest + @testing-library/react + jsdom
- **Test file:** `packages/react/tests/hooks.test.ts`
- **Run all:** `vitest run` in `packages/react`
- **Run single:** `vitest run -t "pattern"`

## Adding Features — Checklist

1. **Implement** new hook or extend existing one in `packages/react/index.ts`.
2. **Maintain direction correctness:** Client sends C events, receives H events.
3. **Ensure ref stability:** Handlers should use `useRef` to avoid unnecessary re-subscriptions.
4. **Add tests** in `tests/hooks.test.ts`.
5. **Export types** using `export type` for type-only re-exports.
6. If the factory approach needs changes, update both `TypedChannelHooks` interface and `createChannelHooks` implementation.

## Code Style Reminders

- `import type` for type-only imports.
- Named exports only — no default exports.
- 2-space indentation, double quotes, semicolons.
- JSDoc `/** */` with `@example` on all public exports.
- Use `createElement` directly (not JSX) since this is a `.ts` file, not `.tsx`.
