# Contributing to native-window

Thanks for your interest in contributing! This guide covers everything you need to get started.

## Prerequisites

- [Bun](https://bun.sh) v1.3 or later
- [Rust](https://rustup.rs) stable toolchain (for the native addon)
- **macOS** or **Windows** (required for native compilation — the native addon cannot be built on Linux)
- TypeScript 5+

## Setup

```bash
# Clone the repository
git clone https://github.com/fcannizzaro/native-window.git
cd native-window

# Install dependencies (links workspace packages automatically)
bun install
```

## Agent & MCP

- [exocommand](https://github.com/fcannizzaro/exocommand) — MCP server that exposes shell commands as tools for AI coding assistants. Required to allow agents to run Rust native compilation (`cargo build`) and linting (`cargo clippy`) through the defined `.exocommand` configuration.

## Project Structure

```
native-window/
├── packages/
│   ├── native-window/            # Rust napi-rs native addon
│   │   ├── src/                  # Rust source code
│   │   │   ├── lib.rs            # Module entry: init(), pumpEvents()
│   │   │   ├── window.rs         # NativeWindow class (#[napi])
│   │   │   ├── window_manager.rs # Global state, command queue
│   │   │   ├── options.rs        # WindowOptions struct
│   │   │   ├── events.rs         # Event callback types
│   │   │   └── platform/
│   │   │       ├── macos.rs      # macOS: WKWebView + AppKit
│   │   │       └── windows.rs    # Windows: WebView2 + Win32
│   │   ├── Cargo.toml
│   │   ├── build.rs
│   │   ├── native-window.d.ts    # TypeScript type declarations
│   │   └── index.ts              # TS entry point + NativeWindow wrapper class
│   └── native-window-ipc/        # Pure TypeScript typed IPC layer
│       ├── index.ts              # Host-side: createChannel, createWindow
│       ├── client.ts             # Webview-side: createChannelClient
│       └── tests/
│           └── channel.test.ts   # Unit tests
└── samples/
    ├── basic.ts                  # Raw IPC example
    └── typed-ipc.ts              # Typed IPC channel example
```

## Building the Native Addon

```bash
cd packages/native-window

# Release build (optimized, stripped)
bun run build

# Debug build (faster compilation, includes debug symbols)
bun run build:debug
```

This compiles the Rust code into a `.node` native addon for your current platform. The build targets are:

| Target                    | Platform              |
| ------------------------- | --------------------- |
| `aarch64-apple-darwin`    | macOS (Apple Silicon) |
| `x86_64-apple-darwin`     | macOS (Intel)         |
| `x86_64-pc-windows-msvc`  | Windows (x64)         |
| `aarch64-pc-windows-msvc` | Windows (ARM64)       |

## Running Tests

The `native-window-ipc` package has unit tests for the typed channel layer:

```bash
cd packages/native-window-ipc
bun run test
```

Tests use a mock `NativeWindow` implementation, so they run on any platform (no native addon needed).

When adding new features to the IPC layer, add corresponding tests in `tests/channel.test.ts`.

## Running Samples

Samples require the native addon to be built first (`bun run build` in `packages/native-window`).

```bash
# Basic raw IPC demo
bun samples/basic.ts

# Typed IPC channel demo
bun samples/typed-ipc.ts
```

## Development Workflow

1. **Native addon changes** (Rust):
   - Edit files in `packages/native-window/src/`
   - Run `bun run build:debug` to compile
   - Test with `bun samples/basic.ts`
   - Use `bun --watch samples/basic.ts` for automatic restarts (not `--hot` — native addons require a process restart)

2. **IPC layer changes** (TypeScript):
   - Edit `packages/native-window-ipc/index.ts` or `client.ts`
   - Run `bun test` in the package directory
   - Test with `bun samples/typed-ipc.ts`

3. **Adding a new window method**:
   - Add the command variant in `src/window_manager.rs` (`Command` enum)
   - Add the `#[napi]` method in `src/window.rs`
   - Implement platform handling in `src/platform/macos.rs` and `src/platform/windows.rs`
   - Update `native-window.d.ts` with the new type declaration

4. **Adding a new IPC event type**:
   - Add the callback type in `src/events.rs`
   - Add the field to `WindowEventHandlers`
   - Add the `#[napi]` handler registration method in `src/window.rs`
   - Update `native-window.d.ts`

## Code Style

- **Rust**: use `rustfmt` defaults. Run `cargo fmt` before committing.
- **TypeScript**: strict mode enabled. No external runtime dependencies in `native-window-ipc`.
- Keep the IPC package **pure TypeScript** — it should never import native modules or platform-specific code.
- Use JSDoc comments on all public exports.

## Pull Requests

- Use a descriptive title that summarizes the change
- Keep each PR focused on a single concern
- Add tests for new IPC features
- Update `native-window.d.ts` when changing the native addon's public API
- Test on at least one supported platform (macOS or Windows) for native changes
