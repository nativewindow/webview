# @nativewindow/ipc

[![npm](https://img.shields.io/npm/v/@nativewindow/ipc)](https://www.npmjs.com/package/@nativewindow/ipc)

> [!NOTE]
> This project is in **beta**. APIs may change without notice.

Pure TypeScript typesafe IPC channel layer for [native-window](https://github.com/nativewindow/webview). Schema-based validation with compile-time checked event maps.

## Install

```bash
bun add @nativewindow/ipc
# or
deno add npm:@nativewindow/ipc
```

## Host side (Bun/Deno/Node)

```ts
import { z } from "zod";
import { createWindow } from "@nativewindow/ipc";

const ch = createWindow(
  { title: "Typed IPC" },
  {
    schemas: {
      host: {
        "update-title": z.string(),
      },
      client: {
        "user-click": z.object({ x: z.number(), y: z.number() }),
        counter: z.number(),
      },
    },
  },
);

// Receive typed messages from the webview (client events)
ch.on("user-click", (pos) => {
  // pos: { x: number; y: number }
  console.log(`Click at ${pos.x}, ${pos.y}`);
});

ch.on("counter", (n) => {
  // n: number
  ch.send("update-title", `Count: ${n}`);
});

// ch.send("counter", "wrong");      // Type error: "counter" is a client event
// ch.send("typo", 123);             // Type error: "typo" does not exist

ch.window.loadHtml(`<html>...</html>`);
```

## Webview side (inline HTML)

The `__channel__` object is auto-injected by `createWindow` / `createChannel`:

```html
<script>
  __channel__.send("user-click", { x: 10, y: 20 });
  __channel__.on("update-title", (title) => {
    document.title = title;
  });
</script>
```

## Webview side (bundled app)

For webview apps bundled with their own build step, import the client directly:

```ts
import { z } from "zod";
import { createChannelClient } from "@nativewindow/ipc/client";

const ch = createChannelClient({
  schemas: {
    host: {
      "update-title": z.string(),
    },
    client: {
      counter: z.number(),
    },
  },
});

// Send client events to the host
ch.send("counter", 42); // Typed!

// Receive host events from the host
ch.on("update-title", (t) => {
  // t: string
  document.title = t;
});
```

## API

### `createChannel(win, options)`

Wrap an existing `NativeWindow` with a typed message channel. Auto-injects the webview client script.

### `createWindow(windowOptions, channelOptions)`

Convenience: creates a `NativeWindow` and wraps it with `createChannel`.

### `getClientScript(options?)`

Returns the webview-side client as a self-contained JS string for manual injection.

### `createChannelClient(options)` (from `/client`)

Create a typed channel client inside the webview for use in bundled apps.

### Channel Options

| Option                 | Type        | Default    | Description                            |
| ---------------------- | ----------- | ---------- | -------------------------------------- |
| `schemas`              | `{ host: SchemaMap; client: SchemaMap }` | _required_ | Directional schemas — `host` for events the host sends, `client` for events the webview sends |
| `injectClient`         | `boolean`   | `true`     | Auto-inject client script into webview |
| `onValidationError`    | `function`  | —          | Called when a payload fails validation |
| `trustedOrigins`       | `string[]`  | —          | Restrict IPC to specific origins       |
| `maxMessageSize`       | `number`    | `1048576`  | Max message size in bytes              |
| `rateLimit`            | `number`    | —          | Max messages per second                |
| `maxListenersPerEvent` | `number`    | —          | Max listeners per event type           |
| `channelId`            | `string`    | —          | Unique channel identifier              |

### Schema Support

Any schema library implementing the [Standard Schema](https://github.com/standard-schema/standard-schema) interface is supported, including:

- [Zod](https://zod.dev) v4
- [Valibot](https://valibot.dev) v1
- [ArkType](https://arktype.io) v2

## Documentation

Full documentation at [nativewindow.fcannizzaro.com](https://nativewindow.fcannizzaro.com)

## License

MIT
