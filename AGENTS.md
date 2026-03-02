# AGENTS.md

## Important Constraints

- Do **not** run `bun run build`. You may run tests (for typescript).
- Do **not** install Rust packages (`cargo install`, `cargo add`) or build the native addon, update only the `cargo.toml`.
- To **build the addon** use the tool `execute("build-native-addon")`.
- To **run clippy** use the tool `execute("clippy-native-addon")`.
- To **run fmt** use the tool `execute("fmt-native-addon")`.
- After every new feature or fix remember to run both the linter, fmt and the native addon build.
- The `native-window-ipc` package must remain **pure TypeScript** with zero runtime dependencies.
- Always fix all rust warnings

## Project Overview

Bun workspace monorepo providing native OS webview windows for Bun/Node.js. The native addon is built with Rust + napi-rs. The typed IPC layer is pure TypeScript.

## Project Structure

```
packages/
  native-window/          # Rust napi-rs native addon
    src/
      lib.rs              # Module entry: init(), pumpEvents()
      window.rs           # NativeWindow class (#[napi])
      window_manager.rs   # Global state, Command enum, command queue
      options.rs          # WindowOptions struct (#[napi(object)])
      events.rs           # Event callback type aliases
      platform/
        macos.rs          # macOS: WKWebView + AppKit
        windows.rs        # Windows: WebView2 + Win32
    index.ts              # TS entry point + NativeWindow wrapper class
    native-window.d.ts    # TS type declarations for the native addon
  native-window-ipc/      # Pure TypeScript typed IPC layer
    index.ts              # Host-side: createChannel, createWindow, getClientScript
    client.ts             # Webview-side: createChannelClient
    tests/
      channel.test.ts     # Unit tests (vitest)
samples/
  src/basic.ts            # Raw IPC example
  src/typed-ipc.ts        # Typed IPC channel example
```

## Build & Run Commands

| Task                    | Command                    | Working Directory            |
| ----------------------- | -------------------------- | ---------------------------- |
| Install deps            | `bun install`              | repo root                    |
| Build addon (release)   | `bun run build`            | `packages/webview`     |
| Build addon (debug)     | `bun run build:debug`      | `packages/webview`     |
| Format Rust             | `cargo fmt`                | `packages/webview`     |
| Lint Rust               | `cargo clippy`             | `packages/webview`     |
| Run all tests           | `vitest run`               | `packages/ipc` |
| Run single test by name | `vitest run -t "pattern"`  | `packages/ipc` |
| Run sample              | `bun samples/src/basic.ts` | repo root                    |

## Testing

- Framework: `vitest`. Uses `describe`/`test`/`expect`/`mock`.
- Tests live in `packages/ipc/tests/channel.test.ts`.
- Tests use a mock `NativeWindow` — no native addon or macOS/Windows required.
- Run a single test: `vitest run -t "test name pattern"` (e.g. `vitest run -t "send() encodes"`).
- Test names use present-tense verb phrases: `"send() encodes messages with $ch envelope"`.
- When adding IPC features, add corresponding tests in `channel.test.ts`.

## TypeScript Code Style

### Formatting

- **2-space indentation**, double quotes, always semicolons, trailing commas in multi-line lists.
- No formatter (Prettier/ESLint) is configured; follow existing style manually.

### Imports

- `import type` for type-only imports (enforced by `verbatimModuleSyntax: true`).
- Named imports only — no default imports.
- Order: external packages first, then relative imports.
- Use `.ts` extension in relative imports within `native-window-ipc`.

### Naming

- `camelCase` for functions, variables, parameters.
- `PascalCase` for types, interfaces, classes.
- `_` prefix for private fields and methods: `_native`, `_closed`, `_handleClose()`.

### Types & Exports

- Explicit return types on all public and private functions.
- Type inference for local variables when type is obvious from context.
- Named exports only — no default exports. Use `export type` for type-only re-exports.
- Constrained generics: `<T extends EventMap>`, key types: `keyof T & string`.

### Error Handling

- `try/catch` with bare `catch {}` (no error binding) when error is unused.
- Return `null` from parse/decode failures.
- Guard clauses with early `return` for invalid input.
- Type guard functions (`data is Envelope`) for type narrowing.
- Prefer `??` over `||`, use `?.` for optional chaining.

### Comments

- JSDoc `/** */` with `@example` on all public exports.
- `@internal` tag on private implementation details.
- Section headers: `// ── Section ──────────────────────────` (em-dash style).
- Subsection headers in classes: `// ---- Section ----`.
- Inline `//` comments explain the "why", not the "what".

## Rust Code Style

### Formatting

- **4-space indentation** (rustfmt defaults). Run `cargo fmt` before committing.
- No `rustfmt.toml` — uses all defaults.

### Imports (`use`)

- Group: std → external crates → `crate::` locals, separated by blank lines.
- Glob imports allowed for napi prelude (`use napi::bindgen_prelude::*`) and platform APIs.

### Naming

- `snake_case` for functions, methods, variables, fields.
- `PascalCase` for types, structs, enums, enum variants.
- `UPPER_SNAKE_CASE` for constants/statics.

### Error Handling

- Return `napi::Result<()>` from all `#[napi]` functions.
- Create errors with `napi::Error::from_reason("descriptive message")`.
- Use `?` operator for propagation, `.ok_or_else(|| ...)` for Option → Result.
- `unwrap_or_default()` for sensible defaults. No `unwrap()` or `expect()` in production.
- `let _ =` to explicitly discard results.

### napi Patterns

- `#[napi(constructor)]` on `new()`, `#[napi(getter)]` on getters.
- `#[napi(object)]` on structs mapping to JS objects (with `#[derive(Debug, Clone)]`).
- `#[napi(ts_args_type = "...")]` for explicit TS callback signatures.
- Optional fields use `Option<T>` with manual `Default` impl.

### Comments

- `///` doc comments on all public items.
- Section headers: `// ---- Section ----`.
- Inline `//` comments for behavior explanation.

### Platform-Specific Code

- Use `#[cfg(target_os = "...")]` blocks, not `if cfg!()`.
- Always handle the unsupported-platform case with a descriptive error.

### Thread Safety

- `thread_local!` with `RefCell` for global mutable state.
- Accessor functions (e.g. `with_manager`) to hide thread-local boilerplate.
- `try_borrow()` with deferred processing for reentrant access.

## Architecture Notes

- **Command queue**: JS calls enqueue `Command` variants. `pumpEvents()` drains and executes them on the main thread, then pumps the OS event loop.
- **IPC envelope**: Messages use `{$ch, p}` JSON format over `postMessage`/`onMessage`.
- **Client injection**: A minified client script is auto-injected into the webview and re-injected on page navigation.

## Adding Features Checklist

**New window method:**

1. Add command variant in `src/window_manager.rs` (`Command` enum).
2. Add `#[napi]` method in `src/window.rs`.
3. Implement in `src/platform/macos.rs` and `src/platform/windows.rs`.
4. Update `native-window.d.ts` with the type declaration.

**New IPC event type:**

1. Add callback type alias in `src/events.rs`.
2. Add field to `WindowEventHandlers`.
3. Add `#[napi]` handler registration method in `src/window.rs`.
4. Update `native-window.d.ts`.

**New IPC channel feature:**

1. Implement in `packages/ipc/index.ts` (host) and/or `client.ts` (webview).
2. Add tests in `tests/channel.test.ts`.
3. Keep the package pure TypeScript — no native or platform imports.
