/**
 * Content Security Policy (CSP) example.
 *
 * Demonstrates how the `csp` window option injects a
 * `<meta http-equiv="Content-Security-Policy">` tag before any page scripts
 * run, restricting what the loaded content can do.
 *
 * This sample uses a restrictive policy that:
 * - Allows inline scripts and styles (`'unsafe-inline'`)
 * - Blocks `eval()` (no `'unsafe-eval'`)
 * - Blocks all images (`img-src 'none'`)
 * - Blocks all network requests (`connect-src 'none'`)
 *
 * @security **Example only.** Tailor your CSP to your application's needs.
 * A production policy should be as restrictive as possible while still
 * allowing the application to function.
 *
 * Run: bun samples/security/src/csp.ts
 */
import { NativeWindow } from "@nativewindow/webview";

const win = new NativeWindow({
  title: "Security: Content Security Policy",
  width: 1024,
  height: 768,
  decorations: true,
  devtools: true,
  csp: "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'",
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
      background: linear-gradient(135deg, #c0392b 0%, #e74c3c 100%);
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
    .tests { display: flex; gap: 16px; flex-wrap: wrap; justify-content: center; }
    .test-card {
      background: rgba(0,0,0,0.2);
      border-radius: 12px;
      padding: 20px;
      min-width: 260px;
      text-align: center;
    }
    .test-card h3 { font-size: 1em; margin-bottom: 8px; }
    .test-card p { font-size: 0.85em; opacity: 0.8; margin-bottom: 12px; }
    .indicator {
      display: inline-block;
      padding: 6px 16px;
      border-radius: 20px;
      font-size: 0.9em;
      font-weight: 600;
    }
    .indicator.pass { background: #27ae60; }
    .indicator.fail { background: #7f8c8d; }
    .indicator.pending { background: rgba(255,255,255,0.2); }
    button {
      padding: 12px 28px;
      font-size: 1.1em;
      border: 2px solid white;
      background: transparent;
      color: white;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s;
    }
    button:hover { background: white; color: #c0392b; }
    #log {
      margin-top: 8px;
      padding: 16px;
      background: rgba(0,0,0,0.3);
      border-radius: 8px;
      width: 100%;
      max-width: 700px;
      max-height: 200px;
      overflow-y: auto;
      font-family: monospace;
      font-size: 0.85em;
    }
    .log-entry { padding: 3px 0; opacity: 0.9; }
    .log-entry.violation { color: #f1c40f; }
    .policy-box {
      background: rgba(0,0,0,0.25);
      border-radius: 8px;
      padding: 12px 20px;
      font-family: monospace;
      font-size: 0.8em;
      max-width: 700px;
      word-break: break-all;
      text-align: center;
    }
  </style>
</head>
<body>
  <h1>Content Security Policy</h1>
  <h2 id="subtitle">The CSP below is injected at document start via the native layer, restricting what this page can do.</h2>
  <div id="policy-box" class="policy-box"></div>

  <div class="tests">
    <div class="test-card">
      <h3>Inline Scripts</h3>
      <p id="inline-desc">Tests if inline scripts execute</p>
      <div id="inline-result" class="indicator pending">Pending</div>
    </div>
    <div class="test-card">
      <h3>eval()</h3>
      <p id="eval-desc">Tests if eval() is allowed</p>
      <div id="eval-result" class="indicator pending">Pending</div>
    </div>
    <div class="test-card">
      <h3>External Images</h3>
      <p id="img-desc">Tests if external images load</p>
      <div id="img-result" class="indicator pending">Pending</div>
    </div>
  </div>

  <button onclick="runTests()">Run All Tests</button>
  <div id="log"></div>

  <script>
    var violations = [];
    var cspMeta = null;

    // Listen for CSP violation reports
    document.addEventListener("securitypolicyviolation", function(e) {
      violations.push(e);
      log("CSP violation: blocked " + e.blockedURI + " (" + e.violatedDirective + ")", true);
    });

    // The native layer injects the CSP <meta> tag via a DOMContentLoaded
    // listener registered at document-start, so it exists by the time our
    // own DOMContentLoaded handler fires.
    document.addEventListener("DOMContentLoaded", function() {
      cspMeta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
      var policyBox = document.getElementById("policy-box");
      var subtitle = document.getElementById("subtitle");
      if (cspMeta) {
        policyBox.textContent = cspMeta.getAttribute("content");
        subtitle.textContent = "The CSP below is injected at document start via the native layer, restricting what this page can do.";
      } else {
        policyBox.textContent = "No CSP configured";
        subtitle.textContent = "No CSP is active. Enable the csp option in WindowOptions to restrict what this page can do.";
      }

      // Test 1: inline script ran (this script block itself proves it)
      document.getElementById("inline-result").textContent = "Allowed";
      document.getElementById("inline-result").className = "indicator pass";
      document.getElementById("inline-desc").textContent = cspMeta
        ? "Allowed by 'unsafe-inline'"
        : "Allowed (no CSP)";
      log("Inline script executed successfully");
    });

    function runTests() {
      // Re-check in case DOMContentLoaded already updated it
      if (!cspMeta) {
        cspMeta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
      }

      // Test 2: eval() should be blocked when CSP is active
      try {
        eval("1 + 1");
        document.getElementById("eval-result").textContent = cspMeta ? "Allowed (unexpected)" : "Allowed";
        document.getElementById("eval-result").className = "indicator " + (cspMeta ? "fail" : "pass");
        document.getElementById("eval-desc").textContent = cspMeta
          ? "Expected to be blocked but was allowed"
          : "Allowed (no CSP)";
        log(cspMeta ? "eval() was allowed (CSP not enforced?)" : "eval() allowed (no CSP active)");
      } catch (e) {
        document.getElementById("eval-result").textContent = "Blocked by CSP";
        document.getElementById("eval-result").className = "indicator pass";
        document.getElementById("eval-desc").textContent = "Blocked (no 'unsafe-eval')";
        log("eval() blocked by CSP as expected");
      }

      // Test 3: external image should be blocked when CSP is active
      var img = new Image();
      img.onload = function() {
        document.getElementById("img-result").textContent = cspMeta ? "Loaded (unexpected)" : "Loaded";
        document.getElementById("img-result").className = "indicator " + (cspMeta ? "fail" : "pass");
        document.getElementById("img-desc").textContent = cspMeta
          ? "Expected to be blocked but loaded"
          : "Loaded (no CSP)";
        log(cspMeta ? "Image loaded (CSP not enforced?)" : "Image loaded (no CSP active)");
      };
      img.onerror = function() {
        if (cspMeta) {
          document.getElementById("img-result").textContent = "Blocked by CSP";
          document.getElementById("img-result").className = "indicator pass";
          document.getElementById("img-desc").textContent = "Blocked by img-src 'none'";
          log("External image blocked by CSP as expected");
        } else {
          document.getElementById("img-result").textContent = "Failed to load";
          document.getElementById("img-result").className = "indicator fail";
          document.getElementById("img-desc").textContent = "Network error (no CSP)";
          log("Image failed to load (network error, no CSP active)");
        }
      };
      img.src = "https://via.placeholder.com/100";

      // Report results to host
      setTimeout(function() {
        window.ipc.postMessage(JSON.stringify({
          test: "csp",
          violations: violations.length,
        }));
      }, 500);
    }

    function log(text, isViolation) {
      var el = document.createElement("div");
      el.className = "log-entry" + (isViolation ? " violation" : "");
      el.textContent = "> " + text;
      document.getElementById("log").appendChild(el);
    }
  </script>
</body>
</html>
`);

// Handle messages from the webview
win.onMessage((message: string, sourceUrl: string) => {
  console.log("[Bun] Received:", message);
  // The sourceUrl shows the synthetic origin used for loadHtml() content
  console.log("[Bun] Source URL:", sourceUrl);
});

win.onClose(() => {
  console.log("[Bun] Window closed");
  process.exit(0);
});

console.log("[Bun] CSP demo window created. Close the window to exit.");
console.log(
  "[Bun] Policy: default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'",
);
