import { createWindow } from "@nativewindow/ipc";
import { createDataSource } from "@nativewindow/tsdb";
import { readFile } from "fs/promises";
import { schemas } from "./schemas";

// ── Security ─────────────────────────────────────────────────────
// This sample enables several IPC security features as best-practice
// defaults. When using loadUrl() instead of loadHtml(), also add
// `trustedOrigins` to both WindowOptions and ChannelOptions to
// restrict IPC to your app's origin.

// ── Types ────────────────────────────────────────────────────────

type Todo = { id: string; text: string; done: boolean };

// ── Counter state ────────────────────────────────────────────────

const randomize = () => Math.round(Math.random() * 1000);

const state = {
  counter: randomize(),
};

// ── Window + IPC channel ─────────────────────────────────────────

const ch = createWindow(
  {
    title: "Advanced Demo",
    width: 1024,
    height: 768,
    decorations: true,
    devtools: true, // disable in production
    csp: "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:",
    // ⬆ CSP 'self' resolves to the custom protocol origin on both platforms:
    //   macOS: nativewindow://localhost   Windows: https://nativewindow.localhost
  },
  {
    injectClient: false,
    schemas,
    onValidationError: (type, payload) => {
      console.warn(`[Bun] Invalid "${type}" payload:`, payload);
    },
    maxMessageSize: 512 * 1024, // 512 KB — drop oversized payloads
    rateLimit: 10, // max 100 incoming messages per second
    maxListenersPerEvent: 10, // cap listeners to detect leaks early
  },
);

// ── TanStack DB data source (host → webview) ────────────────────

const todos = createDataSource<Todo>(ch.window, {
  channel: "tsdb:todos",
  getKey: (todo) => todo.id,
});

// Populate initial todos
todos.batch((b) => {
  b.insert({ id: "1", text: "Learn native-window", done: true });
  b.insert({ id: "2", text: "Try native-window-ipc", done: true });
  b.insert({ id: "3", text: "Use TanStack DB sync", done: false });
  b.insert({ id: "4", text: "Build something cool", done: false });
});

// Simulate live updates from the host every 3 seconds
let tickCount = 0;
setInterval(() => {
  tickCount++;
  const action = tickCount % 3;

  if (action === 0) {
    // Add a new todo
    const id = String(100 + tickCount);
    todos.insert({ id, text: `Auto-added #${tickCount}`, done: false });
    console.log(`[Bun] Inserted todo ${id}`);
  } else if (action === 1) {
    // Toggle todo 3
    todos.update("3", { id: "3", text: "Use TanStack DB sync", done: tickCount % 2 === 1 });
    console.log(`[Bun] Toggled todo 3`);
  } else {
    // Delete the last auto-added todo if any
    const prevId = String(100 + tickCount - 2);
    todos.delete(prevId);
    console.log(`[Bun] Deleted todo ${prevId}`);
  }
}, 3000);

// ── Load webapp ──────────────────────────────────────────────────

const loadContent = async () => {
  const content = await readFile(new URL("../webapp/dist/index.html", import.meta.url), "utf-8");
  ch.window.loadHtml(content);
};

await loadContent();

// Send snapshot so the webview collection gets initial data
todos.sync();

ch.window.onReload(async () => {
  console.log("[Bun] Window reloaded");
  await loadContent();
  // Re-sync after reload so the collection is re-populated
  todos.sync();
});

// ── IPC handlers (counter demo) ──────────────────────────────────

ch.on("setCounter", (counter) => {
  console.log(`[Bun] setCounter: ${counter}`);
  state.counter = counter;
  ch.send("counter", counter);
});

ch.on("randomize", () => {
  state.counter = randomize();
  console.log(`[Bun] randomize: ${state.counter}`);
  ch.send("counter", state.counter);
});

// ── Lifecycle ────────────────────────────────────────────────────

ch.window.onClose(() => {
  console.log("[Bun] Window closed");
});

console.log("[Bun] Advanced Demo window created. Close the window to exit.");
