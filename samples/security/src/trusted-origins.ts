/**
 * Trusted origins example: defense-in-depth IPC origin filtering.
 *
 * Demonstrates two independent layers of origin filtering:
 *
 * 1. **Native layer** (`trustedOrigins` in `WindowOptions`) — the Rust
 *    addon silently drops IPC messages whose source URL origin does not
 *    match the allowlist. This runs before any JS is invoked.
 *
 * 2. **IPC layer** (`trustedOrigins` in `ChannelOptions`) — the TypeScript
 *    `createChannel` function filters messages again and only injects the
 *    client IPC script into pages from trusted origins.
 *
 * Together these layers ensure that even if the webview navigates to an
 * untrusted page, no IPC messages can reach the host application.
 *
 * @security **Example only.** In production, set `trustedOrigins` to
 * your own domain(s). The `loadHtmlOrigin()` helper returns the correct
 * origin for the current platform (`nativewindow://localhost` on macOS/Linux,
 * `https://nativewindow.localhost` on Windows).
 *
 * Run: bun samples/security/src/trusted-origins.ts
 */
import { z } from "zod";
import { createWindow } from "@nativewindow/ipc";
import { loadHtmlOrigin } from "@nativewindow/webview";

const origin = loadHtmlOrigin();

const schemas = {
  host: {
    /** Host -> Webview: status response */
    status: z.string(),
  },
  client: {
    /** Webview -> Host: ping request */
    ping: z.string(),
  },
};

const ch = createWindow(
  {
    title: "Security: Trusted Origins",
    width: 1024,
    height: 768,
    decorations: true,
    devtools: true,
    // Layer 1: native-level origin filtering
    trustedOrigins: [origin],
  },
  {
    schemas,
    // Layer 2: IPC-level origin filtering + client injection gating
    trustedOrigins: [origin],
    onValidationError: (type, payload) => {
      console.warn(`[Bun] Invalid "${type}" payload:`, payload);
    },
  },
);

ch.window.loadHtml(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%);
      color: white;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 40px 20px;
      min-height: 100vh;
      gap: 24px;
    }
    h1 { font-size: 2.2em; text-shadow: 0 2px 4px rgba(0,0,0,0.3); }
    h2 { font-size: 1.1em; opacity: 0.8; font-weight: normal; max-width: 600px; text-align: center; }
    .layers {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
      justify-content: center;
    }
    .layer-card {
      background: rgba(0,0,0,0.25);
      border-radius: 12px;
      padding: 20px;
      min-width: 280px;
      max-width: 320px;
    }
    .layer-card h3 {
      font-size: 1em;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .layer-num {
      background: #3498db;
      border-radius: 50%;
      width: 24px;
      height: 24px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 0.8em;
      flex-shrink: 0;
    }
    .layer-card p { font-size: 0.85em; opacity: 0.8; line-height: 1.5; }
    .layer-card code {
      display: block;
      margin-top: 8px;
      background: rgba(0,0,0,0.3);
      padding: 8px;
      border-radius: 6px;
      font-size: 0.8em;
      word-break: break-all;
    }
    .test-area {
      background: rgba(0,0,0,0.2);
      border-radius: 12px;
      padding: 24px;
      text-align: center;
      min-width: 400px;
    }
    button {
      padding: 12px 28px;
      font-size: 1.1em;
      border: 2px solid white;
      background: transparent;
      color: white;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s;
      margin: 8px;
    }
    button:hover { background: white; color: #2c3e50; }
    .status {
      margin-top: 16px;
      padding: 10px 20px;
      border-radius: 8px;
      font-size: 0.95em;
    }
    .status.success { background: rgba(39, 174, 96, 0.4); }
    .status.waiting { background: rgba(255, 255, 255, 0.1); }
    #log {
      padding: 16px;
      background: rgba(0,0,0,0.3);
      border-radius: 8px;
      width: 100%;
      max-width: 700px;
      max-height: 180px;
      overflow-y: auto;
      font-family: monospace;
      font-size: 0.85em;
    }
    .log-entry { padding: 3px 0; }
    .log-entry.in { color: #2ecc71; }
    .log-entry.out { color: #f1c40f; }
  </style>
</head>
<body>
  <h1>Trusted Origins</h1>
  <h2>IPC messages are filtered at two independent layers. Only messages from trusted origins reach the host.</h2>

  <div class="layers">
    <div class="layer-card">
      <h3><span class="layer-num">1</span> Native Layer</h3>
      <p>The Rust addon checks the source URL origin of every incoming IPC message. Untrusted messages are silently dropped before any JavaScript runs.</p>
      <code>trustedOrigins: ["${origin}"]</code>
    </div>
    <div class="layer-card">
      <h3><span class="layer-num">2</span> IPC Layer</h3>
      <p>The TypeScript channel filters messages again and only injects the client script into pages from trusted origins. Untrusted pages never get the IPC bridge.</p>
      <code>trustedOrigins: ["${origin}"]</code>
    </div>
  </div>

  <div class="test-area">
    <button onclick="sendPing()">Send Ping</button>
    <button onclick="sendMultiple()">Send 3 Pings</button>
    <div id="status" class="status waiting">Waiting for test...</div>
  </div>

  <div id="log"></div>

  <script>
    var pingCount = 0;
    var responseCount = 0;

    function sendPing() {
      pingCount++;
      var msg = "ping-" + pingCount;
      __channel__.send("ping", msg);
      log("Sent: " + msg, "out");
      setStatus("waiting", "Waiting for response...");
    }

    function sendMultiple() {
      for (var i = 0; i < 3; i++) {
        sendPing();
      }
    }

    function setStatus(cls, text) {
      var el = document.getElementById("status");
      el.className = "status " + cls;
      el.textContent = text;
    }

    function log(text, dir) {
      var el = document.createElement("div");
      el.className = "log-entry" + (dir ? " " + dir : "");
      el.textContent = (dir === "out" ? "-> " : "<- ") + text;
      document.getElementById("log").appendChild(el);
      document.getElementById("log").scrollTop = document.getElementById("log").scrollHeight;
    }

    // Wait for the IPC client script to be injected (it arrives via
    // onPageLoad("finished") after the inline scripts have already run).
    function init() {
      if (typeof __channel__ === "undefined") {
        setTimeout(init, 50);
        return;
      }
      // Listen for status responses from the host
      __channel__.on("status", function(msg) {
        responseCount++;
        log("Received: " + msg, "in");
        setStatus("success", "Message accepted (" + responseCount + " total responses)");
      });
      log("Ready. This page origin: " + window.location.origin, "in");
    }
    init();
  </script>
</body>
</html>
`);

// Handle typed ping messages — only arrives if origin is trusted
ch.on("ping", (msg) => {
  console.log("[Bun] Ping received:", msg);
  ch.send("status", `Accepted "${msg}" from trusted origin`);
});

ch.window.onClose(() => {
  console.log("[Bun] Window closed");
  process.exit(0);
});

console.log("[Bun] Trusted origins demo created. Close the window to exit.");
console.log(`[Bun] Native trustedOrigins: [${origin}]`);
console.log(`[Bun] IPC trustedOrigins:    [${origin}]`);
