/**
 * IPC hardening example: rate limiting, message size limits,
 * schema validation, channel namespacing, and listener caps.
 *
 * Demonstrates the security options available in `ChannelOptions`
 * from `native-window-ipc`:
 *
 * - **Rate limiting** — caps incoming messages per second.
 * - **Message size limit** — drops oversized payloads silently.
 * - **Schema validation** — rejects payloads that don't match the schema.
 * - **Channel namespace** — auto-generated nonce prevents event spoofing.
 * - **Max listeners** — prevents unbounded listener growth.
 *
 * @security **Example only.** The limits here are intentionally low for
 * demonstration. Tune these values based on your application's needs.
 *
 * Run: bun samples/security/src/ipc-hardening.ts
 */
import { z } from "zod";
import { createWindow } from "@nativewindow/ipc";

const schemas = {
  host: {
    /** Host -> Webview: feedback message */
    feedback: z.string(),
  },
  client: {
    /** Webview -> Host: simple ping */
    ping: z.string().max(100),
    /** Webview -> Host: structured user data */
    "user-data": z.object({
      name: z.string().min(1).max(50),
      age: z.number().int().positive(),
    }),
  },
};

const ch = createWindow(
  {
    title: "Security: IPC Hardening",
    width: 1024,
    height: 768,
    decorations: true,
    devtools: true,
  },
  {
    schemas,
    channelId: true, // auto-generated nonce namespace
    maxMessageSize: 1024, // 1 KB — drop oversized payloads
    rateLimit: 5, // max 5 incoming messages per second
    maxListenersPerEvent: 3, // cap listeners to detect leaks early
    onValidationError: (type, payload) => {
      console.warn(`[Bun] Validation failed for "${type}":`, payload);
      ch.send("feedback", `Rejected: invalid "${type}" payload`);
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
      background: linear-gradient(135deg, #8e44ad 0%, #9b59b6 100%);
      color: white;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 30px 20px;
      min-height: 100vh;
      gap: 20px;
    }
    h1 { font-size: 2.2em; text-shadow: 0 2px 4px rgba(0,0,0,0.3); }
    .limits-bar {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      justify-content: center;
    }
    .limit-badge {
      background: rgba(0,0,0,0.3);
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 0.8em;
      font-family: monospace;
    }
    .tests { display: flex; gap: 14px; flex-wrap: wrap; justify-content: center; width: 100%; max-width: 800px; }
    .test-card {
      background: rgba(0,0,0,0.2);
      border-radius: 12px;
      padding: 18px;
      flex: 1 1 340px;
      max-width: 390px;
    }
    .test-card h3 { font-size: 1em; margin-bottom: 6px; }
    .test-card p { font-size: 0.8em; opacity: 0.75; margin-bottom: 12px; line-height: 1.4; }
    button {
      padding: 8px 18px;
      font-size: 0.9em;
      border: 2px solid rgba(255,255,255,0.7);
      background: transparent;
      color: white;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s;
      margin: 3px;
    }
    button:hover { background: rgba(255,255,255,0.2); }
    .result {
      margin-top: 10px;
      padding: 8px;
      background: rgba(0,0,0,0.2);
      border-radius: 6px;
      font-family: monospace;
      font-size: 0.8em;
      min-height: 32px;
    }
    #log {
      padding: 14px;
      background: rgba(0,0,0,0.3);
      border-radius: 8px;
      width: 100%;
      max-width: 800px;
      max-height: 160px;
      overflow-y: auto;
      font-family: monospace;
      font-size: 0.8em;
    }
    .log-entry { padding: 2px 0; }
    .log-entry.in { color: #2ecc71; }
    .log-entry.out { color: #f1c40f; }
    .log-entry.err { color: #e74c3c; }
  </style>
</head>
<body>
  <h1>IPC Hardening</h1>
  <div class="limits-bar">
    <span class="limit-badge">Rate: 5/s</span>
    <span class="limit-badge">Max Size: 1 KB</span>
    <span class="limit-badge">Namespace: on</span>
    <span class="limit-badge">Max Listeners: 3</span>
  </div>

  <div class="tests">
    <!-- Rate Limiting -->
    <div class="test-card">
      <h3>Rate Limiting</h3>
      <p>Send 20 messages in rapid succession. Only ~5 per second should reach the host.</p>
      <button onclick="testRateLimit()">Flood 20 Messages</button>
      <div class="result" id="rate-result">Click to test</div>
    </div>

    <!-- Message Size -->
    <div class="test-card">
      <h3>Message Size Limit</h3>
      <p>Send a payload exceeding the 1 KB limit (silently dropped) vs. a small one.</p>
      <button onclick="testLargePayload()">Send Large (2 KB)</button>
      <button onclick="testSmallPayload()">Send Small</button>
      <div class="result" id="size-result">Click to test</div>
    </div>

    <!-- Schema Validation -->
    <div class="test-card">
      <h3>Schema Validation</h3>
      <p>Send valid and invalid data. Invalid payloads are rejected before reaching handlers.</p>
      <button onclick="testValidData()">Valid Data</button>
      <button onclick="testInvalidData()">Invalid Data</button>
      <div class="result" id="schema-result">Click to test</div>
    </div>

    <!-- Channel Namespace -->
    <div class="test-card">
      <h3>Channel Namespace</h3>
      <p>An auto-generated nonce prefixes all event types, preventing untrusted scripts from spoofing messages.</p>
      <button onclick="testNamespace()">Show Namespace</button>
      <div class="result" id="ns-result">Click to reveal</div>
    </div>
  </div>

  <div id="log"><div class="log-entry">Ready.</div></div>

  <script>
    var receivedCount = 0;

    // Listen for feedback from the host
    __channel__.on("feedback", function(msg) {
      log(msg, "in");
    });

    // ---- Rate Limiting Test ----
    function testRateLimit() {
      var sent = 20;
      receivedCount = 0;
      document.getElementById("rate-result").textContent = "Sending " + sent + " messages...";
      for (var i = 0; i < sent; i++) {
        __channel__.send("ping", "rate-test-" + (i + 1));
      }
      log("Sent " + sent + " pings rapidly", "out");
      // Wait a moment to count responses
      setTimeout(function() {
        document.getElementById("rate-result").textContent =
          "Sent: " + sent + " | Received by host: " + receivedCount + " (rate limited to 5/s)";
      }, 1500);
    }

    // ---- Message Size Test ----
    function testLargePayload() {
      // Create a string > 1024 bytes
      var large = "x".repeat(2048);
      __channel__.send("ping", large);
      log("Sent 2 KB payload (should be dropped)", "out");
      document.getElementById("size-result").textContent = "Sent 2 KB payload — check log for response";
      setTimeout(function() {
        document.getElementById("size-result").textContent =
          "2 KB payload was silently dropped (no response)";
      }, 1000);
    }

    function testSmallPayload() {
      __channel__.send("ping", "small-payload");
      log("Sent small payload", "out");
      document.getElementById("size-result").textContent = "Sent small payload — waiting...";
    }

    // ---- Schema Validation Test ----
    function testValidData() {
      __channel__.send("user-data", { name: "Alice", age: 30 });
      log("Sent valid: { name: 'Alice', age: 30 }", "out");
      document.getElementById("schema-result").textContent = "Sent valid data — waiting...";
    }

    function testInvalidData() {
      // Age is negative and name is a number — fails schema validation
      __channel__.send("user-data", { name: 123, age: -5 });
      log("Sent invalid: { name: 123, age: -5 }", "out");
      document.getElementById("schema-result").textContent = "Sent invalid data — should be rejected";
    }

    // ---- Channel Namespace Test ----
    function testNamespace() {
      // The __channel__ object exposes internal state we can inspect
      var info = "Channel active: " + (typeof __channel__ !== "undefined") +
        "\\nNamespace prevents event spoofing via raw postMessage";
      document.getElementById("ns-result").textContent = info;
      log("Channel namespace is active (auto-nonce)", "in");
    }

    function log(text, dir) {
      var el = document.createElement("div");
      el.className = "log-entry" + (dir ? " " + dir : "");
      var prefix = dir === "out" ? "-> " : dir === "in" ? "<- " : "   ";
      el.textContent = prefix + text;
      document.getElementById("log").appendChild(el);
      document.getElementById("log").scrollTop = document.getElementById("log").scrollHeight;
    }
  </script>
</body>
</html>
`);

// Track received pings for the rate limit test
let pingCount = 0;

ch.on("ping", (msg) => {
  pingCount++;
  console.log(`[Bun] Ping #${pingCount}: ${msg}`);
  // Send feedback so the webview can count responses
  ch.send("feedback", `Accepted ping #${pingCount}: ${msg.slice(0, 40)}`);
  // Also update the webview's received count via evaluateJs
  ch.window.unsafe.evaluateJs(`receivedCount = ${pingCount}`);
});

ch.on("user-data", (data) => {
  console.log(`[Bun] Valid user data: ${data.name}, age ${data.age}`);
  ch.send("feedback", `Accepted: ${data.name}, age ${data.age}`);
});

ch.window.onClose(() => {
  console.log("[Bun] Window closed");
  process.exit(0);
});

console.log("[Bun] IPC hardening demo created. Close the window to exit.");
console.log("[Bun] Limits: rate=5/s, maxSize=1KB, namespace=auto, maxListeners=3");
