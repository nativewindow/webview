# @nativewindow/react

[![npm](https://img.shields.io/npm/v/@nativewindow/react)](https://www.npmjs.com/package/@nativewindow/react)

> [!WARNING]
> This project is in **alpha**. APIs may change without notice.

React hooks for [native-window-ipc](https://github.com/nativewindow/webview/tree/main/packages/ipc). Provides type-safe React bindings for the webview side of the IPC channel.

## Install

```bash
bun add @nativewindow/react
# or
deno add npm:@nativewindow/react
```

### Peer Dependencies

- `react` ^18.0.0 || ^19.0.0
- `@nativewindow/ipc`

## Usage

### Factory approach (recommended)

Create pre-typed hooks from your schemas:

```ts
// channel.ts
import { z } from "zod";
import { createChannelHooks } from "@nativewindow/react";

export const { ChannelProvider, useChannel, useChannelEvent, useSend } = createChannelHooks({
  schemas: {
    counter: z.number(),
    "update-title": z.string(),
  },
});
```

### Provider setup

Wrap your app with `ChannelProvider`:

```tsx
import { ChannelProvider } from "./channel";

function App() {
  return (
    <ChannelProvider>
      <Counter />
    </ChannelProvider>
  );
}
```

### Hooks

```tsx
import { useChannelEvent, useSend } from "./channel";

function Counter() {
  const [count, setCount] = useState(0);
  const send = useSend();

  // Subscribe to events with automatic cleanup
  useChannelEvent("counter", (n) => {
    setCount(n);
  });

  return <button onClick={() => send("counter", count + 1)}>Count: {count}</button>;
}
```

## API

### `createChannelHooks(options)`

Factory that returns pre-typed `{ ChannelProvider, useChannel, useChannelEvent, useSend }`. Each call creates its own React context, supporting multiple independent channels.

### `ChannelProvider`

React component that creates a `createChannelClient` instance and provides it via context.

### `useChannel()`

Access the typed channel from context. Throws if used outside `ChannelProvider`.

### `useChannelEvent(type, handler)`

Subscribe to a specific IPC event type. Automatically cleans up on unmount. Handler is stored in a ref to avoid re-subscriptions on handler identity changes.

### `useSend()`

Returns a stable `send` function (memoized via `useCallback`).

## Documentation

Full documentation at [nativewindow.fcannizzaro.com](https://nativewindow.fcannizzaro.com)

## License

MIT
