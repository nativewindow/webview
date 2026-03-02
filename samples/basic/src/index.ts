/**
 * Basic example: raw IPC with native-window.
 *
 * @security **Example only.** Do not use in production without proper input
 * validation and sanitization. This sample echoes messages for demonstration
 * purposes; a real application should validate all incoming data.
 *
 * Run: bun samples/src/basic.ts
 *
 * This sample simulates a long-running background process: a heartbeat
 * setInterval keeps the process alive after the window closes, so you can
 * verify that the macOS Dock icon disappears cleanly on close while the
 * process itself stays running. Press Ctrl+C to quit.
 */
import { NativeWindow } from "@nativewindow/webview";

// ── Simulate a long-running background process ──────────────────────────────
// Keeps the Node/Bun event loop alive indefinitely (like a daemon, a WebSocket
// connection, or a Stream Deck plugin would). This lets you verify that the
// Dock icon disappears when the window closes even though the process is still
// running. Press Ctrl+C to quit.
const heartbeat = setInterval(() => {
  process.stdout.write(".");
}, 2_000);

// Allow Ctrl+C to exit cleanly
process.on("SIGINT", () => {
  clearInterval(heartbeat);
  console.log("\n[Bun] Exiting.");
  process.exit(0);
});

// ── Create the window ────────────────────────────────────────────────────────

function openWindow() {
  const win = new NativeWindow({
    title: "Basic Demo",
    width: 1024,
    height: 768,
    decorations: true,
    devtools: true, // disable in production
  });

  // Load HTML content with raw IPC bridge
  win.loadHtml(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      gap: 20px;
    }
    h1 { font-size: 2.5em; text-shadow: 0 2px 4px rgba(0,0,0,0.3); }
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
    button:hover { background: white; color: #764ba2; }
    #messages {
      margin-top: 20px;
      padding: 16px;
      background: rgba(0,0,0,0.2);
      border-radius: 8px;
      min-width: 300px;
      max-height: 200px;
      overflow-y: auto;
    }
    .msg { padding: 4px 0; font-family: monospace; }

    /* ── Countdown bar ── */
    #countdown-wrap {
      position: fixed;
      bottom: 0; left: 0; right: 0;
      padding: 10px 20px 14px;
      background: rgba(0,0,0,0.25);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    #countdown-label {
      font-size: 0.85em;
      opacity: 0.9;
      letter-spacing: 0.02em;
    }
    #countdown-track {
      height: 6px;
      background: rgba(255,255,255,0.2);
      border-radius: 3px;
      overflow: hidden;
    }
    #countdown-bar {
      height: 100%;
      width: 100%;
      background: white;
      border-radius: 3px;
      transform-origin: left;
      transition: width 1s linear, background 1s linear;
    }
  </style>
</head>
<body>
  <h1>Native Webview</h1>
  <p>Running inside a native OS window via native-window</p>
  <button onclick="sendMessage()">Send Message to Bun</button>
  <button onclick="sendCounter()">Send Counter</button>
  <div id="messages"><div class="msg">Ready.</div></div>

  <div id="countdown-wrap">
    <div id="countdown-label">Auto-closing in <b id="countdown-s">10</b>s — Dock icon should disappear</div>
    <div id="countdown-track"><div id="countdown-bar"></div></div>
  </div>

  <script>
    let counter = 0;
    const TOTAL = 10;
    let remaining = TOTAL;

    // Tick every second
    const bar = document.getElementById('countdown-bar');
    const label = document.getElementById('countdown-s');
    const interval = setInterval(() => {
      remaining--;
      label.textContent = remaining;
      const pct = (remaining / TOTAL) * 100;
      bar.style.width = pct + '%';
      // Fade from white → orange → red as time runs out
      if (remaining <= 3) bar.style.background = '#ff4d4d';
      else if (remaining <= 5) bar.style.background = '#ffaa00';
    }, 1000);

    function sendMessage() {
      window.ipc.postMessage('Hello from the webview!');
      log('Sent: Hello from the webview!');
    }

    function sendCounter() {
      counter++;
      window.ipc.postMessage(JSON.stringify({ type: 'counter', value: counter }));
      log('Sent counter: ' + counter);
    }

    // Handle messages from Bun/Node
    window.__native_message__ = function(msg) {
      log('Received from Bun: ' + msg);
    };

    function log(text) {
      const div = document.getElementById('messages');
      const el = document.createElement('div');
      el.className = 'msg';
      el.textContent = '> ' + text;
      div.appendChild(el);
      div.scrollTop = div.scrollHeight;
    }
  </script>
</body>
</html>
`);

  // Handle messages from the webview
  win.onMessage((message: string) => {
    console.log("\n[Bun] Received from webview:", message);

    // Sanitize before echoing: truncate to a safe length and strip HTML tags.
    // In production, use a proper validation/sanitization library.
    const MAX_LENGTH = 1024;
    const sanitized = message.slice(0, MAX_LENGTH).replace(/<[^>]*>/g, "");

    win.postMessage(`Echo: ${sanitized}`);
  });

  // Handle window close
  win.onClose(() => {
    console.log("\n[Bun] Window closed — process still running (heartbeat active).");
    console.log("[Bun] On macOS, the Dock icon should now be gone.");
    console.log("[Bun] Press Ctrl+C to quit.");
  });

  // Auto-close after 10 s to test Dock icon cleanup without manual interaction
  setTimeout(() => {
    console.log("\n[Bun] Auto-closing window after 10s...");
    win.close();
  }, 10_000);

  return win;
}

openWindow();

console.log("[Bun] Native window created. Close the window — the process will keep running.");
console.log("[Bun] On macOS, verify the Dock icon disappears after closing the window.");
console.log("[Bun] Press Ctrl+C to quit.");
