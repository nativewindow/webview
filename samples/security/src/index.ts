/**
 * Production-ready security configuration example.
 *
 * Demonstrates all major security features working together in a
 * defense-in-depth configuration suitable for production use:
 *
 * - **CSP** — restrictive Content Security Policy injected at document start.
 * - **DevTools disabled** — prevents content inspection in production.
 * - **Allowed hosts** — navigation locked to internal origins (auto-allowed for loadHtml).
 * - **Trusted origins** — dual-layer IPC filtering (native + IPC).
 * - **Channel namespace** — auto-nonce prevents event spoofing.
 * - **Rate limiting** — caps incoming IPC messages per second.
 * - **Message size limit** — drops oversized payloads.
 * - **Max listeners** — prevents unbounded listener growth.
 * - **Schema validation** — runtime payload validation via Zod.
 * - **sanitizeForJs** — safe string embedding for evaluateJs().
 * - **Cookie auditing** — inspect HttpOnly cookies from the native store.
 *
 * @security This sample shows the recommended production configuration.
 * Adjust limits and policies to match your application's requirements.
 *
 * Run: bun samples/security/src/index.ts
 */
import { z } from "zod";
import { createWindow } from "@nativewindow/ipc";
import { sanitizeForJs, loadHtmlOrigin } from "@nativewindow/webview";

const origin = loadHtmlOrigin();

// ── Schemas ────────────────────────────────────────────────

const schemas = {
  /** Webview -> Host: user performed an action */
  "user-action": z.object({
    action: z.string().max(50),
    timestamp: z.number(),
  }),
  /** Webview -> Host: request a cookie audit */
  "request-cookies": z.literal(true),
  /** Host -> Webview: status/feedback message */
  status: z.string(),
  /** Host -> Webview: cookie audit report */
  "cookie-report": z.string(),
};

// ── Window + Channel ───────────────────────────────────────

const ch = createWindow(
  {
    title: "Security: Production Configuration",
    width: 1024,
    height: 768,
    decorations: true,
    devtools: false, // disabled in production
    csp: "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'",
    trustedOrigins: [origin],
  },
  {
    schemas,
    trustedOrigins: [origin],
    channelId: true, // auto-nonce namespace
    maxMessageSize: 64 * 1024, // 64 KB
    rateLimit: 30, // 30 messages per second
    maxListenersPerEvent: 5,
    onValidationError: (type, payload) => {
      console.warn(`[Bun] Rejected invalid "${type}" payload:`, payload);
    },
  },
);

// ── HTML Content ───────────────────────────────────────────

ch.window.loadHtml(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: #e0e0e0;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 30px 20px;
      min-height: 100vh;
      gap: 20px;
    }
    h1 { font-size: 2em; color: white; text-shadow: 0 2px 4px rgba(0,0,0,0.5); }
    h2 { font-size: 1em; opacity: 0.6; font-weight: normal; }
    .dashboard { display: flex; gap: 16px; flex-wrap: wrap; justify-content: center; width: 100%; max-width: 900px; }
    .panel {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 12px;
      padding: 18px;
    }
    .panel h3 { font-size: 0.95em; color: white; margin-bottom: 12px; }
    .sidebar { flex: 0 0 280px; }
    .main { flex: 1 1 500px; }
    .feature-list { list-style: none; }
    .feature-list li {
      padding: 6px 0;
      font-size: 0.82em;
      display: flex;
      align-items: flex-start;
      gap: 8px;
      line-height: 1.4;
    }
    .check {
      color: #2ecc71;
      font-weight: bold;
      flex-shrink: 0;
      margin-top: 1px;
    }
    .feature-label { opacity: 0.7; }
    .feature-value { color: #3498db; font-family: monospace; font-size: 0.95em; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
    button {
      padding: 8px 18px;
      font-size: 0.85em;
      border: 1px solid rgba(255,255,255,0.3);
      background: rgba(255,255,255,0.05);
      color: white;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s;
    }
    button:hover { background: rgba(255,255,255,0.15); border-color: rgba(255,255,255,0.5); }
    #log {
      padding: 14px;
      background: rgba(0,0,0,0.4);
      border-radius: 8px;
      font-family: monospace;
      font-size: 0.8em;
      max-height: 220px;
      overflow-y: auto;
    }
    .log-entry { padding: 2px 0; }
    .log-entry.in { color: #2ecc71; }
    .log-entry.out { color: #f1c40f; }
    .log-entry.info { color: #3498db; }
    .log-entry.err { color: #e74c3c; }
    .footer {
      font-size: 0.75em;
      opacity: 0.4;
      text-align: center;
      max-width: 600px;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <h1>Production Security Configuration</h1>
  <h2>All security layers active — defense in depth</h2>

  <div class="dashboard">
    <div class="panel sidebar">
      <h3>Security Status</h3>
      <ul class="feature-list">
        <li><span class="check">+</span><div><span class="feature-label">CSP: </span><span class="feature-value">active</span></div></li>
        <li><span class="check">+</span><div><span class="feature-label">DevTools: </span><span class="feature-value">disabled</span></div></li>
        <li><span class="check">+</span><div><span class="feature-label">Allowed Hosts: </span><span class="feature-value">auto-allowed (loadHtml)</span></div></li>
        <li><span class="check">+</span><div><span class="feature-label">Trusted Origins (native): </span><span class="feature-value">${origin}</span></div></li>
        <li><span class="check">+</span><div><span class="feature-label">Trusted Origins (IPC): </span><span class="feature-value">${origin}</span></div></li>
        <li><span class="check">+</span><div><span class="feature-label">Channel Namespace: </span><span class="feature-value">auto-nonce</span></div></li>
        <li><span class="check">+</span><div><span class="feature-label">Rate Limit: </span><span class="feature-value">30/s</span></div></li>
        <li><span class="check">+</span><div><span class="feature-label">Max Message Size: </span><span class="feature-value">64 KB</span></div></li>
        <li><span class="check">+</span><div><span class="feature-label">Max Listeners/Event: </span><span class="feature-value">5</span></div></li>
        <li><span class="check">+</span><div><span class="feature-label">Schema Validation: </span><span class="feature-value">zod</span></div></li>
        <li><span class="check">+</span><div><span class="feature-label">IPC Bridge: </span><span class="feature-value">frozen</span></div></li>
      </ul>
    </div>

    <div class="panel main">
      <h3>Actions</h3>
      <div class="actions">
        <button onclick="sendAction('click')">Send Action</button>
        <button onclick="requestCookies()">Cookie Audit</button>
        <button onclick="sendInvalid()">Invalid Payload</button>
      </div>
      <div id="log">
        <div class="log-entry info">Dashboard ready. All security layers active.</div>
      </div>
    </div>
  </div>

  <div class="footer">
    Defense in depth: CSP restricts page capabilities, allowedHosts prevents navigation to untrusted domains,
    trustedOrigins filters IPC at both native and application layers, schema validation rejects malformed payloads,
    rate limiting prevents flooding, and the frozen IPC bridge resists tampering.
  </div>

  <script>
    function sendAction(name) {
      __channel__.send("user-action", { action: name, timestamp: Date.now() });
      log("Sent action: " + name, "out");
    }

    function requestCookies() {
      __channel__.send("request-cookies", true);
      log("Requested cookie audit", "out");
    }

    function sendInvalid() {
      // This will fail schema validation — action is too long and timestamp is a string
      __channel__.send("user-action", { action: "x".repeat(100), timestamp: "not-a-number" });
      log("Sent invalid payload (should be rejected)", "out");
    }

    function log(text, cls) {
      var el = document.createElement("div");
      el.className = "log-entry" + (cls ? " " + cls : "");
      el.textContent = (cls === "out" ? "-> " : cls === "in" ? "<- " : "   ") + text;
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
      __channel__.on("status", function(msg) {
        log(msg, "in");
      });
      __channel__.on("cookie-report", function(report) {
        log("Cookie audit:\\n" + report, "info");
      });
    }
    init();
  </script>
</body>
</html>
`);

// ── Host-Side Handlers ─────────────────────────────────────

ch.on("user-action", (data) => {
  console.log(`[Bun] Action: ${data.action} at ${data.timestamp}`);
  // Sanitize the action string before sending it back (defense in depth)
  const safe = sanitizeForJs(data.action);
  ch.send("status", `Accepted action: "${safe}" (validated + sanitized)`);
});

ch.on("request-cookies", async () => {
  console.log("[Bun] Cookie audit requested");
  try {
    const cookies = await ch.window.getCookies();
    if (cookies.length === 0) {
      ch.send("cookie-report", "No cookies found (expected for local HTML content)");
    } else {
      const report = cookies
        .map((c) => `${c.name}: httpOnly=${c.httpOnly}, secure=${c.secure}, sameSite=${c.sameSite}`)
        .join("\n");
      ch.send("cookie-report", report);
    }
  } catch {
    ch.send("cookie-report", "Cookie access not available");
  }
});

ch.window.onNavigationBlocked((url: string) => {
  console.log("[Bun] Navigation blocked:", url);
});

ch.window.onClose(() => {
  console.log("[Bun] Window closed");
  process.exit(0);
});

// ── Startup ────────────────────────────────────────────────

console.log("[Bun] Production security demo created. Close the window to exit.");
console.log("[Bun] Security layers active:");
console.log("[Bun]   CSP: default-src 'self'; script-src 'unsafe-inline'; ...");
console.log("[Bun]   DevTools: disabled");
console.log("[Bun]   Allowed hosts: auto-allowed (loadHtml content)");
console.log(`[Bun]   Trusted origins: ${origin} (native + IPC)`);
console.log("[Bun]   Channel namespace: auto-nonce");
console.log("[Bun]   Rate limit: 30/s | Max size: 64 KB | Max listeners: 5");
