# Contributing to native-window

## Prerequisites

- Node.js 24.19.0, pinned in `.node-version`
- pnpm 10.34.9, pinned in the root `package.json`
- Rust stable for native addon work
- macOS, Windows, or Linux with the required WebKitGTK development libraries

Vite+ supplies Vite, Vitest, Oxlint, Oxfmt, and the workspace task runner. A global `vp` installation is optional. Package scripts use the locally pinned toolchain through pnpm. Bun remains a supported consumer runtime.

## Setup

```bash
git clone https://github.com/nativewindow/webview.git
cd webview
pnpm install --frozen-lockfile
```

Run installation from the repository root. The libraries, samples, platform binary packages, and docs share `pnpm-workspace.yaml` and `pnpm-lock.yaml`.

## Project structure

- `packages/webview`: Rust napi-rs addon, wry/tao backend, TypeScript entry point
- `packages/ipc`: typed host and webview IPC channels
- `packages/react`: React hooks and provider
- `packages/tsdb`: host data source and TanStack DB collection adapter
- `samples/basic`, `samples/security`: TypeScript host examples
- `samples/advanced/webapp`: Vite web application embedded by the advanced host
- `docs`: Next.js/Fumadocs static documentation site

## Checks without native compilation

```bash
pnpm run build:ts
pnpm test
pnpm run typecheck
pnpm run lint
pnpm run format
```

Build the TypeScript packages before checking consumers, which resolve workspace packages through their emitted declarations. Tests mock the native boundary and do not need a native binary. Vite+ discovers the IPC, React, and TSDB test projects from the root `vite.config.ts`.

The root Vite+ config owns shared formatting. Markdown and MDX keep their existing prose formatting. `pnpm run lint` uses Oxlint; existing warnings are reported without suppressions.

## Native addon

For local development:

```bash
pnpm --filter @nativewindow/webview run build
pnpm --filter @nativewindow/webview run build:debug
```

Both commands compile the addon and build its TypeScript wrapper. `pnpm run build:ts` only builds TypeScript.

Run the native checks from the repository root without an MCP server:

```bash
pnpm run format:native
pnpm run lint:native
pnpm run build:native
pnpm run test:native
```

Clippy checks all addon targets with the locked dependencies and treats Rust warnings as errors. The native smoke check imports the compiled wrapper and addon in Node without opening a window; CI runs it after the native build.

For macOS event-loop changes, restart the advanced sample with the rebuilt addon. Check the red Close, yellow Minimize, and green Fullscreen buttons with ordinary mouse clicks. Also run `node samples/basic/src/multiwindow.ts`, close windows one at a time, and check that the remaining windows respond and the Dock icon disappears after the last close. Stop the sample's background logging with Ctrl+C when finished.

The native targets are macOS ARM64/x64, Windows ARM64/x64, and Linux ARM64/x64. Linux builds require GTK 3 and WebKitGTK 4.1 development libraries. CI and publishing install those libraries where needed.

## Samples and docs

Build the native addon and TypeScript libraries first, then run:

```bash
pnpm --filter basic-sample dev
node samples/basic/src/typed-ipc.ts
pnpm --filter security-sample dev
pnpm --filter advanced-sample build-webapp
pnpm --filter advanced-sample dev
pnpm --filter docs dev
pnpm --filter docs build
```

Node runs these TypeScript hosts directly. Local imports need explicit `.ts` extensions. Use `node --watch` when developing a host; native changes require restarting the process.

## Changes and releases

Keep IPC pure TypeScript with zero runtime dependencies. Add behavior tests to the affected package and update public API documentation when changing contracts. Rust changes need native checks on the supported platforms.

Use `pnpm changeset` for release notes. The publish workflow builds packages, synchronizes native platform versions, and publishes pnpm-packed tarballs with npm provenance. Workspace development dependencies are not consumer runtime dependencies.
