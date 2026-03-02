/* eslint-disable */
// JS loader for the native addon.
// Tries local .node files first (development), then per-platform npm packages (production).

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { platform, arch } = process;

const platforms = {
  "darwin-arm64": {
    pkg: "@nativewindow/webview-darwin-arm64",
    file: "native-window.darwin-arm64.node",
  },
  "darwin-x64": {
    pkg: "@nativewindow/webview-darwin-x64",
    file: "native-window.darwin-x64.node",
  },
  "win32-x64": {
    pkg: "@nativewindow/webview-win32-x64-msvc",
    file: "native-window.win32-x64-msvc.node",
  },
  "win32-arm64": {
    pkg: "@nativewindow/webview-win32-arm64-msvc",
    file: "native-window.win32-arm64-msvc.node",
  },
  "linux-x64": {
    pkg: "@nativewindow/webview-linux-x64-gnu",
    file: "native-window.linux-x64-gnu.node",
  },
  "linux-arm64": {
    pkg: "@nativewindow/webview-linux-arm64-gnu",
    file: "native-window.linux-arm64-gnu.node",
  },
};

const key = `${platform}-${arch}`;
const entry = platforms[key];

if (!entry) {
  throw new Error(`Unsupported platform: ${key}`);
}

const tryRequire = (id) => {
  try {
    return require(id);
  } catch {
    return null;
  }
};

const nativeBinding = tryRequire(`./${entry.file}`) ?? tryRequire(entry.pkg);

if (!nativeBinding) {
  throw new Error(
    `Failed to load native binding for platform: ${key}. ` +
      `Ensure the correct platform package is installed or the .node file exists.`,
  );
}

export const { NativeWindow, init, pumpEvents, checkRuntime, ensureRuntime, loadHtmlOrigin } =
  nativeBinding;
