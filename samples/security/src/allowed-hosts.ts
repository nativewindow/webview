/**
 * Navigation restriction example using `allowedHosts`.
 *
 * Demonstrates how the `allowedHosts` window option restricts ALL
 * navigations (link clicks, form submissions, redirects, and `loadUrl()`)
 * to a set of permitted host patterns. Blocked navigations fire the
 * `onNavigationBlocked` callback.
 *
 * Also shows how dangerous URL schemes (`data:`, `file:`,
 * `blob:`) are blocked at the native layer regardless of the allowlist.
 *
 * @security **Example only.** In production, restrict `allowedHosts` to
 * your own domains and use wildcards sparingly.
 *
 * Run: bun samples/security/src/allowed-hosts.ts
 */
import { NativeWindow } from "@nativewindow/webview";

const win = new NativeWindow({
  title: "Security: Allowed Hosts",
  width: 1024,
  height: 768,
  decorations: true,
  devtools: true,
  allowedHosts: ["example.com", "*.example.com"],
});

// Track blocked navigations and relay them to the webview
win.onNavigationBlocked((url: string) => {
  console.log("[Bun] Navigation blocked:", url);
  win.postMessage(JSON.stringify({ blocked: url }));
});

win.onPageLoad((event: string, url: string) => {
  console.log(`[Bun] Page ${event}: ${url}`);
});

win.loadHtml(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #16a085 0%, #1abc9c 100%);
      color: white;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 40px 20px;
      min-height: 100vh;
      gap: 24px;
    }
    h1 { font-size: 2.2em; text-shadow: 0 2px 4px rgba(0,0,0,0.3); }
    h2 { font-size: 1.1em; opacity: 0.8; font-weight: normal; }
    .config {
      background: rgba(0,0,0,0.2);
      border-radius: 8px;
      padding: 12px 20px;
      font-family: monospace;
      font-size: 0.9em;
    }
    .targets {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      max-width: 700px;
      width: 100%;
    }
    .target-card {
      background: rgba(0,0,0,0.2);
      border-radius: 12px;
      padding: 16px;
      cursor: pointer;
      transition: all 0.2s;
      border: 2px solid transparent;
    }
    .target-card:hover { border-color: rgba(255,255,255,0.4); }
    .target-card h3 { font-size: 0.95em; margin-bottom: 4px; }
    .target-card .url { font-family: monospace; font-size: 0.8em; opacity: 0.7; word-break: break-all; }
    .target-card .expected {
      margin-top: 8px;
      font-size: 0.8em;
      padding: 3px 10px;
      border-radius: 12px;
      display: inline-block;
    }
    .expected.allow { background: #27ae60; }
    .expected.block { background: #e74c3c; }
    #log {
      padding: 16px;
      background: rgba(0,0,0,0.3);
      border-radius: 8px;
      width: 100%;
      max-width: 700px;
      max-height: 220px;
      overflow-y: auto;
      font-family: monospace;
      font-size: 0.85em;
    }
    .log-entry { padding: 3px 0; }
    .log-entry.blocked { color: #e74c3c; }
    .log-entry.allowed { color: #2ecc71; }
  </style>
</head>
<body>
  <h1>Navigation Restriction</h1>
  <h2>Only navigations to allowed hosts are permitted. Click a card to test.</h2>
  <div class="config">allowedHosts: ["example.com", "*.example.com"]</div>

  <div class="targets">
    <div class="target-card" onclick="tryNavigate('https://example.com')">
      <h3>example.com</h3>
      <div class="url">https://example.com</div>
      <div class="expected allow">Expected: Allowed</div>
    </div>
    <div class="target-card" onclick="tryNavigate('https://sub.example.com')">
      <h3>sub.example.com</h3>
      <div class="url">https://sub.example.com</div>
      <div class="expected allow">Expected: Allowed (wildcard)</div>
    </div>
    <div class="target-card" onclick="tryNavigate('https://google.com')">
      <h3>google.com</h3>
      <div class="url">https://google.com</div>
      <div class="expected block">Expected: Blocked</div>
    </div>
    <div class="target-card" onclick="tryNavigate('https://github.com')">
      <h3>github.com</h3>
      <div class="url">https://github.com</div>
      <div class="expected block">Expected: Blocked</div>
    </div>
    <div class="target-card" onclick="tryNavigate('data:text/html,<h1>XSS</h1>')">
      <h3>data: scheme</h3>
      <div class="url">data:text/html,&lt;h1&gt;XSS&lt;/h1&gt;</div>
      <div class="expected block">Expected: Blocked (scheme)</div>
    </div>
  </div>

  <div id="log"><div class="log-entry">Ready. Click a card to attempt navigation.</div></div>

  <script>
    function tryNavigate(url) {
      log("Attempting: " + url);
      // Use location.href to trigger a real navigation
      window.location.href = url;
    }

    // Handle messages from the host (blocked navigation reports)
    window.__native_message__ = function(msg) {
      try {
        var data = JSON.parse(msg);
        if (data.blocked) {
          log("Blocked: " + data.blocked, "blocked");
        }
      } catch(e) {}
    };

    function log(text, cls) {
      var el = document.createElement("div");
      el.className = "log-entry" + (cls ? " " + cls : "");
      el.textContent = "> " + text;
      document.getElementById("log").appendChild(el);
      document.getElementById("log").scrollTop = document.getElementById("log").scrollHeight;
    }
  </script>
</body>
</html>
`);

win.onMessage((message: string) => {
  console.log("[Bun] Received from webview:", message);
});

win.onClose(() => {
  console.log("[Bun] Window closed");
  process.exit(0);
});

console.log("[Bun] Allowed hosts demo created. Close the window to exit.");
console.log("[Bun] Allowed: example.com, *.example.com");
console.log("[Bun] Blocked: everything else + dangerous URL schemes");
