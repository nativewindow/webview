/**
 * Input sanitization and the unsafe namespace pattern.
 *
 * Demonstrates:
 *
 * - **`sanitizeForJs()`** — escapes strings for safe embedding inside
 *   `evaluateJs()` calls, preventing script injection via crafted input.
 * - **`win.unsafe.evaluateJs()`** — the `unsafe` namespace makes injection
 *   risk visible at the call site, so code reviewers can easily spot it.
 * - **Frozen IPC bridge** — `window.ipc` is `Object.freeze()`d and defined
 *   as non-writable/non-configurable, preventing page scripts from
 *   intercepting or monkey-patching the native IPC pathway.
 *
 * @security **Example only.** Always use `sanitizeForJs()` when
 * interpolating any external or user-provided strings into `evaluateJs()`.
 * The `unsafe` namespace exists to remind developers of this requirement.
 *
 * Run: bun samples/security/src/sanitize.ts
 */
import { NativeWindow, sanitizeForJs } from "@nativewindow/webview";

const win = new NativeWindow({
  title: "Security: Input Sanitization",
  width: 1024,
  height: 768,
  decorations: true,
  devtools: true,
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
      background: linear-gradient(135deg, #e67e22 0%, #f39c12 100%);
      color: white;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 30px 20px;
      min-height: 100vh;
      gap: 20px;
    }
    h1 { font-size: 2.2em; text-shadow: 0 2px 4px rgba(0,0,0,0.3); }
    h2 { font-size: 1.1em; opacity: 0.8; font-weight: normal; max-width: 600px; text-align: center; }
    .columns { display: flex; gap: 16px; flex-wrap: wrap; justify-content: center; width: 100%; max-width: 850px; }
    .column { flex: 1 1 380px; max-width: 420px; }
    .card {
      background: rgba(0,0,0,0.2);
      border-radius: 12px;
      padding: 18px;
      margin-bottom: 14px;
    }
    .card h3 { font-size: 1em; margin-bottom: 8px; }
    .card p { font-size: 0.8em; opacity: 0.75; margin-bottom: 12px; line-height: 1.4; }
    textarea {
      width: 100%;
      height: 70px;
      padding: 10px;
      border: 2px solid rgba(255,255,255,0.4);
      background: rgba(0,0,0,0.2);
      color: white;
      border-radius: 8px;
      font-family: monospace;
      font-size: 0.9em;
      resize: vertical;
    }
    textarea::placeholder { color: rgba(255,255,255,0.4); }
    button {
      padding: 8px 18px;
      font-size: 0.9em;
      border: 2px solid rgba(255,255,255,0.7);
      background: transparent;
      color: white;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s;
      margin: 4px 4px 4px 0;
    }
    button:hover { background: rgba(255,255,255,0.2); }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0; }
    .chip {
      padding: 4px 10px;
      background: rgba(0,0,0,0.3);
      border-radius: 14px;
      font-size: 0.75em;
      font-family: monospace;
      cursor: pointer;
      transition: background 0.2s;
    }
    .chip:hover { background: rgba(0,0,0,0.5); }
    .output {
      padding: 12px;
      background: rgba(0,0,0,0.3);
      border-radius: 8px;
      font-family: monospace;
      font-size: 0.85em;
      min-height: 40px;
      word-break: break-all;
      white-space: pre-wrap;
    }
    .status-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 14px;
      font-size: 0.85em;
      font-weight: 600;
    }
    .status-badge.pass { background: #27ae60; }
    .status-badge.fail { background: #e74c3c; }
    #log {
      padding: 14px;
      background: rgba(0,0,0,0.3);
      border-radius: 8px;
      width: 100%;
      max-width: 850px;
      max-height: 140px;
      overflow-y: auto;
      font-family: monospace;
      font-size: 0.8em;
    }
    .log-entry { padding: 2px 0; }
    .log-entry.in { color: #2ecc71; }
    .log-entry.out { color: #f1c40f; }
  </style>
</head>
<body>
  <h1>Input Sanitization</h1>
  <h2>sanitizeForJs() escapes strings for safe embedding in evaluateJs(). The unsafe namespace makes injection risk visible.</h2>

  <div class="columns">
    <!-- Left column: input and presets -->
    <div class="column">
      <div class="card">
        <h3>Send Input to Host</h3>
        <p>Type any text (including malicious payloads). The host sanitizes it with sanitizeForJs() before injecting it back via evaluateJs().</p>
        <textarea id="input" placeholder='Try: He said "hello"'></textarea>
        <div>
          <button onclick="sendInput()">Send to Host</button>
        </div>
        <div class="chips">
          <span class="chip" onclick="setInput('He said &quot;hello&quot;')">double quotes</span>
          <span class="chip" onclick="setInput('</scr' + 'ipt><script>alert(1)</scr' + 'ipt>')">&lt;/script&gt; breakout</span>
          <span class="chip" onclick="setInput('line1\\nline2\\r\\0null')">control chars</span>
          <span class="chip" onclick="setInput('foo\\u2028bar\\u2029baz')">unicode separators</span>
          <span class="chip" onclick="setInput('&quot;; alert(&quot;pwned&quot;); &quot;')">injection attempt</span>
        </div>
      </div>

      <div class="card">
        <h3>IPC Bridge Integrity</h3>
        <p>window.ipc is frozen and non-writable. Attempts to tamper with it fail silently.</p>
        <button onclick="testFreeze()">Test Tamper Resistance</button>
        <div id="freeze-result" style="margin-top: 10px;">
          <span class="status-badge pass" style="display:none" id="freeze-pass">Frozen</span>
          <span class="status-badge fail" style="display:none" id="freeze-fail">Vulnerable</span>
        </div>
        <div class="output" id="freeze-output" style="margin-top: 8px; min-height: 20px;"></div>
      </div>
    </div>

    <!-- Right column: output -->
    <div class="column">
      <div class="card">
        <h3>Safe Output</h3>
        <p>The host sanitizes your input and sends it back via evaluateJs(). The result appears below — rendered safely via textContent.</p>
        <div class="output" id="safe-output">Waiting for input...</div>
      </div>

      <div class="card">
        <h3>How It Works</h3>
        <p style="opacity: 1; font-family: monospace; font-size: 0.8em; line-height: 1.6;">
          // Host receives message from webview:<br>
          win.onMessage((input) => {<br>
          &nbsp;&nbsp;// Safe: sanitized before injection<br>
          &nbsp;&nbsp;const safe = sanitizeForJs(input);<br>
          &nbsp;&nbsp;win.unsafe.evaluateJs(<br>
          &nbsp;&nbsp;&nbsp;&nbsp;\`showResult("\${safe}")\`<br>
          &nbsp;&nbsp;);<br>
          });<br>
          <br>
          // The "unsafe" namespace signals risk<br>
          // Code reviewers can easily flag it
        </p>
      </div>
    </div>
  </div>

  <div id="log"></div>

  <script>
    function sendInput() {
      var text = document.getElementById("input").value;
      if (!text) return;
      window.ipc.postMessage(text);
      log("Sent: " + text.slice(0, 80), "out");
    }

    function setInput(text) {
      document.getElementById("input").value = text;
    }

    // Called by the host via evaluateJs() after sanitization
    function showResult(text) {
      // Use textContent to prevent XSS — the string is already safe
      // because sanitizeForJs() escaped it for the JS context,
      // and textContent escapes it for the HTML context.
      document.getElementById("safe-output").textContent = text;
      log("Received sanitized result", "in");
    }

    function testFreeze() {
      var results = [];

      // Test 1: try to replace window.ipc
      var original = window.ipc;
      try {
        window.ipc = { postMessage: function() { return "hijacked"; } };
      } catch(e) {}
      var replaceBlocked = (window.ipc === original);
      results.push("Replace window.ipc: " + (replaceBlocked ? "blocked" : "FAILED"));

      // Test 2: try to overwrite postMessage
      var originalPM = window.ipc.postMessage;
      try {
        window.ipc.postMessage = function() { return "hijacked"; };
      } catch(e) {}
      var overwriteBlocked = (window.ipc.postMessage === originalPM);
      results.push("Overwrite postMessage: " + (overwriteBlocked ? "blocked" : "FAILED"));

      // Test 3: try to add a new property
      try {
        window.ipc.evil = "payload";
      } catch(e) {}
      var extendBlocked = !("evil" in window.ipc);
      results.push("Extend window.ipc: " + (extendBlocked ? "blocked" : "FAILED"));

      var allPassed = replaceBlocked && overwriteBlocked && extendBlocked;
      document.getElementById("freeze-pass").style.display = allPassed ? "inline-block" : "none";
      document.getElementById("freeze-fail").style.display = allPassed ? "none" : "inline-block";
      document.getElementById("freeze-output").textContent = results.join("\\n");
      log("IPC bridge tamper test: " + (allPassed ? "all blocked" : "VULNERABLE"), allPassed ? "in" : "out");
    }

    function log(text, dir) {
      var el = document.createElement("div");
      el.className = "log-entry" + (dir ? " " + dir : "");
      el.textContent = (dir === "out" ? "-> " : "<- ") + text;
      document.getElementById("log").appendChild(el);
      document.getElementById("log").scrollTop = document.getElementById("log").scrollHeight;
    }

    log("Ready. Type input or select a preset.", "in");
  </script>
</body>
</html>
`);

// Handle messages — sanitize input before injecting back into the webview
win.onMessage((message: string) => {
  console.log("[Bun] Received raw input:", message);

  // Safe: sanitizeForJs() escapes the string for embedding in a JS literal.
  // The "unsafe" namespace makes the injection risk visible at the call site.
  const sanitized = sanitizeForJs(message);
  win.unsafe.evaluateJs(`showResult("${sanitized}")`);

  console.log("[Bun] Injected sanitized result back into webview");

  // For comparison, this is what an UNSAFE version looks like (DO NOT DO THIS):
  // win.unsafe.evaluateJs(`showResult("${message}")`);
  // ^ If message contains: "); alert("pwned"); ("
  //   it would execute: showResult(""); alert("pwned"); ("")
});

win.onClose(() => {
  console.log("[Bun] Window closed");
  process.exit(0);
});

console.log("[Bun] Sanitization demo created. Close the window to exit.");
console.log("[Bun] Try sending malicious input — sanitizeForJs() will neutralize it.");
