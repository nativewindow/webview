/**
 * Typed IPC example: typesafe communication with native-window-ipc.
 *
 * @security **Example only.** Schemas provide runtime validation for
 * all incoming payloads. TypeScript types are inferred from schemas
 * automatically — no separate type definition needed.
 *
 * Run: bun samples/src/typed-ipc.ts
 */
import { z } from "zod";
import { createWindow } from "@nativewindow/ipc";

// Define schemas — types are inferred automatically.
// In a real app, put these in a shared file (e.g. shared/schemas.ts).
const schemas = {
  /** Webview -> Bun: user clicked somewhere */
  "user-click": z.object({ x: z.number(), y: z.number() }),
  /** Webview -> Bun: counter incremented */
  counter: z.number(),
  /** Bun -> Webview: update the displayed title */
  "update-title": z.string(),
  /** Bun -> Webview: echo back the last message */
  echo: z.string(),
};

// Create a typed channel window (init + event pump start automatically)
const ch = createWindow(
  {
    title: "Typed IPC Demo",
    width: 1024,
    height: 768,
    decorations: true,
    devtools: true, // disable in production
  },
  {
    schemas,
    onValidationError: (type, payload) => {
      console.warn(`[Bun] Invalid "${type}" payload:`, payload);
    },
  },
);

// Load HTML — the __channel__ object is auto-injected by createWindow
ch.window.loadHtml(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #2c3e50 0%, #3498db 100%);
      color: white;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      gap: 20px;
    }
    h1 { font-size: 2.5em; text-shadow: 0 2px 4px rgba(0,0,0,0.3); }
    h2 { font-size: 1.2em; opacity: 0.7; font-weight: normal; }
    p { font-size: 1.2em; opacity: 0.9; }
    button {
      padding: 12px 24px;
      font-size: 1.1em;
      border: 2px solid white;
      background: transparent;
      color: white;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s;
    }
    button:hover { background: white; color: #2c3e50; }
    .buttons { display: flex; gap: 12px; }
    #messages {
      margin-top: 20px;
      padding: 16px;
      background: rgba(0,0,0,0.2);
      border-radius: 8px;
      min-width: 400px;
      max-height: 200px;
      overflow-y: auto;
    }
    .msg { padding: 4px 0; font-family: monospace; font-size: 0.9em; }
    .msg.in { color: #2ecc71; }
    .msg.out { color: #f1c40f; }
  </style>
</head>
<body>
  <h1 id="title">Typed IPC Demo</h1>
  <h2>native-window-ipc</h2>
  <p>Typesafe bidirectional messaging between Bun and webview</p>
  <div class="buttons">
    <button onclick="sendClick(event)">Send Click Position</button>
    <button onclick="sendCounter()">Increment Counter</button>
  </div>
  <div id="messages"><div class="msg">Ready. Using typed __channel__ API.</div></div>

  <script>
    let counter = 0;

    function sendClick(e) {
      // Typed: sends { x: number, y: number } on the "user-click" channel
      __channel__.send('user-click', { x: e.clientX, y: e.clientY });
      log('out', 'Sent click: (' + e.clientX + ', ' + e.clientY + ')');
    }

    function sendCounter() {
      counter++;
      // Typed: sends number on the "counter" channel
      __channel__.send('counter', counter);
      log('out', 'Sent counter: ' + counter);
    }

    // Typed: receives string on the "update-title" channel
    __channel__.on('update-title', function(title) {
      document.getElementById('title').textContent = title;
      log('in', 'Title updated: ' + title);
    });

    // Typed: receives string on the "echo" channel
    __channel__.on('echo', function(msg) {
      log('in', 'Echo: ' + msg);
    });

    function log(dir, text) {
      var div = document.getElementById('messages');
      var el = document.createElement('div');
      el.className = 'msg ' + dir;
      el.textContent = (dir === 'out' ? '-> ' : '<- ') + text;
      div.appendChild(el);
      div.scrollTop = div.scrollHeight;
    }
  </script>
</body>
</html>
`);

// Typed handlers — payload types are inferred from the schemas.
// Schemas provide runtime validation automatically — invalid payloads
// are rejected before reaching handlers.

ch.on("user-click", (pos) => {
  console.log(`[Bun] Click at (${pos.x}, ${pos.y})`);
  ch.send("echo", `Click received at (${pos.x}, ${pos.y})`);
});

ch.on("counter", (n) => {
  console.log(`[Bun] Counter: ${n}`);
  ch.send("update-title", `Typed IPC Demo - Count: ${n}`);
});

// These would be type errors (uncomment to see):
// ch.send("counter", "wrong");      // string is not assignable to number
// ch.send("typo", 123);             // "typo" does not exist in schemas
// ch.on("counter", (s: string) => {}); // string is not assignable to number

ch.window.onClose(() => {
  console.log("[Bun] Window closed");
  process.exit(0);
});

console.log("[Bun] Typed IPC window created. Close the window to exit.");
