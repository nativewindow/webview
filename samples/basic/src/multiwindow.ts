/**
 * Multiwindow example: open several windows and close them one by one.
 *
 * Exercises the window lifecycle to verify:
 * - Dock icon stays visible while at least one window is open
 * - Each window remains responsive after siblings are closed
 * - The event pump keeps running until the last window closes
 * - Dock icon disappears cleanly once the last window is gone
 *
 * Run: node samples/basic/src/multiwindow.ts
 *
 * Instructions:
 *   1. Four windows appear, each with a distinct colour.
 *   2. Close them one by one with the [x] button.
 *   3. Verify the remaining windows stay responsive (buttons work,
 *      timer ticks) and the Dock icon is visible.
 *   4. After the last window closes the process exits.
 */
import { NativeWindow } from "@nativewindow/webview";

// ── Colour palette for each window ──────────────────────────────────────

const themes = [
  { name: "Indigo", bg: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)" },
  { name: "Ocean", bg: "linear-gradient(135deg, #2193b0 0%, #6dd5ed 100%)" },
  { name: "Sunset", bg: "linear-gradient(135deg, #f12711 0%, #f5af19 100%)" },
  { name: "Forest", bg: "linear-gradient(135deg, #134e5e 0%, #71b280 100%)" },
];

// ── State ───────────────────────────────────────────────────────────────

const windows: NativeWindow[] = [];
let openCount = themes.length;

// Keep the event loop alive while windows are open
const heartbeat = setInterval(() => {}, 5_000);

// ── HTML template ───────────────────────────────────────────────────────

function html(index: number, total: number): string {
  const { name, bg } = themes[index]!;
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: ${bg};
      color: white;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      gap: 16px;
      user-select: none;
    }
    h1 { font-size: 2.2em; text-shadow: 0 2px 4px rgba(0,0,0,0.3); }
    .info { font-size: 1.1em; opacity: 0.85; }
    #timer { font-family: monospace; font-size: 1.4em; margin-top: 8px; }
    button {
      padding: 10px 22px;
      font-size: 1em;
      border: 2px solid white;
      background: transparent;
      color: white;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s;
    }
    button:hover { background: white; color: #333; }
    #log {
      margin-top: 12px;
      padding: 12px 16px;
      background: rgba(0,0,0,0.2);
      border-radius: 8px;
      min-width: 280px;
      max-height: 120px;
      overflow-y: auto;
      font-family: monospace;
      font-size: 0.85em;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <h1>${name} Window</h1>
  <div class="info">Window ${index + 1} of ${total}</div>
  <div id="timer">0s</div>
  <button onclick="ping()">Ping Host</button>
  <div id="log"></div>

  <script>
    var seconds = 0;
    var timerEl = document.getElementById('timer');
    var logEl   = document.getElementById('log');

    setInterval(function () {
      seconds++;
      timerEl.textContent = seconds + 's';
    }, 1000);

    function ping() {
      window.ipc.postMessage('ping');
      appendLog('sent ping');
    }

    window.__native_message__ = function (msg) {
      appendLog('recv: ' + msg);
    };

    function appendLog(text) {
      var line = document.createElement('div');
      line.textContent = '> ' + text;
      logEl.appendChild(line);
      logEl.scrollTop = logEl.scrollHeight;
    }
  </script>
</body>
</html>`;
}

// ── Create windows ──────────────────────────────────────────────────────

for (let i = 0; i < themes.length; i++) {
  const offset = i * 40;
  const win = new NativeWindow({
    title: `${themes[i]!.name} (${i + 1}/${themes.length})`,
    width: 480,
    height: 400,
    x: 100 + offset,
    y: 100 + offset,
    devtools: true,
  });

  win.loadHtml(html(i, themes.length));

  win.onMessage((message: string) => {
    console.log(`[Window ${i + 1}] message: ${message}`);
    win.postMessage(`pong from host (window ${i + 1})`);
  });

  win.onClose(() => {
    openCount--;
    console.log(`[Window ${i + 1}] closed  |  remaining: ${openCount}/${themes.length}`);
    if (openCount === 0) {
      clearInterval(heartbeat);
      console.log("[Host] All windows closed. Exiting.");
    }
  });

  windows.push(win);
}

console.log(`[Host] ${themes.length} windows created.`);
console.log("[Host] Close them one by one with the [x] button.");
console.log("[Host] Verify each remaining window stays responsive.");

setInterval(() => {
  console.log("=== Testing long running process with multiple windows closed ===");
}, 5000);
