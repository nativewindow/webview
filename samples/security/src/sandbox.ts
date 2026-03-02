/**
 * Sandbox & permission control demo.
 *
 * Demonstrates the sandboxing features added to `NativeWindow`:
 *
 * - **Permission controls** — `allowCamera` and `allowMicrophone`
 *   are `false` by default (deny-all). Toggle the flags below to
 *   see how the UI and expected results change.
 * - **Popup blocking** — `window.open()` is blocked unconditionally.
 *
 * Each card shows a rich, interactive result when the API is granted:
 * live camera preview, real-time microphone volume meter, etc.
 *
 * Run: bun samples/security/src/sandbox.ts
 */
import { NativeWindow } from "@nativewindow/webview";

// ── Permission configuration ───────────────────────────────
// Toggle these to test granting individual permissions.
const allowCamera = true;
const allowMicrophone = true;
const allowFileSystem = true;

const win = new NativeWindow({
  title: "Security: Sandbox & Permissions",
  width: 920,
  height: 760,
  decorations: true,
  devtools: true,
  allowCamera,
  allowMicrophone,
  allowFileSystem,
});

// ── Helpers for dynamic HTML ───────────────────────────────

/** CSS class for the expected-result badge. */
const cls = (allowed: boolean): string => (allowed ? "allow" : "deny");

/** Label text for the expected-result badge. */
const lbl = (allowed: boolean): string => (allowed ? "Expected: Allowed" : "Expected: Denied");

/** Display value for the config status bar. */
const val = (allowed: boolean): string => String(allowed);

// Camera + Mic requires both to be true.
const allowCameraMic = allowCamera && allowMicrophone;

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
      background: linear-gradient(135deg, #2c3e50 0%, #3498db 100%);
      color: white;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 32px 20px;
      min-height: 100vh;
      gap: 20px;
    }
    h1 { font-size: 2em; text-shadow: 0 2px 4px rgba(0,0,0,0.3); }
    h2 { font-size: 1em; opacity: 0.8; font-weight: normal; }
    .config {
      background: rgba(0,0,0,0.2);
      border-radius: 8px;
      padding: 10px 18px;
      font-family: monospace;
      font-size: 0.8em;
      line-height: 1.6;
      text-align: center;
    }
    .tests {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      max-width: 720px;
      width: 100%;
    }
    .test-card {
      background: rgba(0,0,0,0.2);
      border-radius: 12px;
      padding: 14px;
      cursor: pointer;
      transition: all 0.2s;
      border: 2px solid transparent;
    }
    .test-card:hover { border-color: rgba(255,255,255,0.4); }
    .test-card h3 { font-size: 0.9em; margin-bottom: 3px; }
    .test-card .desc { font-size: 0.75em; opacity: 0.7; }
    .test-card .badge {
      margin-top: 6px;
      font-size: 0.75em;
      padding: 2px 10px;
      border-radius: 12px;
      display: inline-block;
    }
    .badge.deny { background: #e74c3c; }
    .badge.allow { background: #27ae60; }
    .badge.block { background: #e67e22; }
    .result {
      margin-top: 10px;
      padding: 8px;
      border-radius: 8px;
      background: rgba(0,0,0,0.25);
      font-size: 0.8em;
      display: none;
      overflow: hidden;
    }
    .result.visible { display: block; }
    .result.denied { border-left: 3px solid #e74c3c; }
    .result.granted { border-left: 3px solid #2ecc71; }
    .result.blocked { border-left: 3px solid #e67e22; }
    .result video {
      width: 100%;
      border-radius: 6px;
      background: #000;
    }
    .result pre {
      white-space: pre-wrap;
      word-break: break-all;
      font-family: monospace;
      font-size: 0.85em;
      line-height: 1.4;
    }
    .meter-bar {
      height: 14px;
      border-radius: 7px;
      background: rgba(255,255,255,0.15);
      overflow: hidden;
      margin-top: 6px;
    }
    .meter-fill {
      height: 100%;
      width: 0%;
      border-radius: 7px;
      background: linear-gradient(90deg, #2ecc71, #f1c40f, #e74c3c);
      transition: width 60ms linear;
    }
    .stop-btn {
      margin-top: 8px;
      padding: 4px 12px;
      border: 1px solid rgba(255,255,255,0.4);
      background: rgba(255,255,255,0.1);
      color: white;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.8em;
    }
    .stop-btn:hover { background: rgba(255,255,255,0.2); }
    .footer {
      font-size: 0.7em;
      opacity: 0.4;
      text-align: center;
      max-width: 600px;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <h1>Sandbox &amp; Permissions</h1>
  <h2>Click a card to test each sandbox restriction.</h2>
  <div class="config">
    allowCamera: ${val(allowCamera)} &nbsp;|&nbsp;
    allowMicrophone: ${val(allowMicrophone)} &nbsp;|&nbsp;
    allowFileSystem: ${val(allowFileSystem)}
  </div>

  <div class="tests">
    <!-- Camera -->
    <div class="test-card" onclick="testCamera()">
      <h3>Camera</h3>
      <div class="desc">getUserMedia({ video: true })</div>
      <div class="badge ${cls(allowCamera)}">${lbl(allowCamera)}</div>
      <div class="result" id="camera-result"></div>
    </div>

    <!-- Microphone -->
    <div class="test-card" onclick="testMicrophone()">
      <h3>Microphone</h3>
      <div class="desc">getUserMedia({ audio: true })</div>
      <div class="badge ${cls(allowMicrophone)}">${lbl(allowMicrophone)}</div>
      <div class="result" id="mic-result"></div>
    </div>

    <!-- Popup -->
    <div class="test-card" onclick="testPopup()">
      <h3>Popup / window.open()</h3>
      <div class="desc">window.open("https://example.com")</div>
      <div class="badge block">Expected: Blocked</div>
      <div class="result" id="popup-result"></div>
    </div>

    <!-- Camera + Mic -->
    <div class="test-card" onclick="testCameraMic()">
      <h3>Camera + Mic</h3>
      <div class="desc">getUserMedia({ video: true, audio: true })</div>
      <div class="badge ${cls(allowCameraMic)}">${lbl(allowCameraMic)}</div>
      <div class="result" id="cameramic-result"></div>
    </div>
  </div>

  <div class="footer">
    All permissions are denied by default for maximum security.
    Toggle allowCamera, allowMicrophone in the source to test.
    Popups are always blocked. Microphone/camera may also require macOS system permission.
  </div>

  <script>
    // ── Active streams (for stop buttons) ──
    var activeStreams = {};

    function showResult(id, html, cls) {
      var el = document.getElementById(id);
      el.innerHTML = html;
      el.className = "result visible " + (cls || "");
    }

    function stopStream(key, resultId) {
      if (activeStreams[key]) {
        activeStreams[key].getTracks().forEach(function(t) { t.stop(); });
        delete activeStreams[key];
      }
      if (activeStreams[key + "-raf"]) {
        cancelAnimationFrame(activeStreams[key + "-raf"]);
        delete activeStreams[key + "-raf"];
      }
      var el = document.getElementById(resultId);
      if (el) {
        el.className = "result";
        el.innerHTML = "";
      }
    }

    // ── Camera ──
    function testCamera() {
      stopStream("camera", "camera-result");
      showResult("camera-result", "Requesting camera...", "granted");
      navigator.mediaDevices.getUserMedia({ video: true })
        .then(function(stream) {
          activeStreams["camera"] = stream;
          showResult("camera-result",
            '<video id="cam-video" autoplay playsinline muted></video>' +
            '<button class="stop-btn" onclick="event.stopPropagation(); stopStream(\\'camera\\', \\'camera-result\\')">Stop Camera</button>',
            "granted"
          );
          document.getElementById("cam-video").srcObject = stream;
        })
        .catch(function(e) {
          showResult("camera-result",
            "<b>DENIED</b><br>" + e.name + ": " + e.message +
            "<br><small>Check macOS System Settings &gt; Privacy &gt; Camera</small>",
            "denied"
          );
        });
    }

    // ── Microphone ──
    function testMicrophone() {
      stopStream("mic", "mic-result");
      showResult("mic-result", "Requesting microphone...", "granted");
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then(function(stream) {
          activeStreams["mic"] = stream;
          showResult("mic-result",
            '<div>Listening...</div>' +
            '<div class="meter-bar"><div class="meter-fill" id="mic-meter"></div></div>' +
            '<button class="stop-btn" onclick="event.stopPropagation(); stopStream(\\'mic\\', \\'mic-result\\')">Stop Mic</button>',
            "granted"
          );
          // Set up volume meter
          var ctx = new AudioContext();
          var src = ctx.createMediaStreamSource(stream);
          var analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          src.connect(analyser);
          var data = new Uint8Array(analyser.frequencyBinCount);
          function draw() {
            if (!activeStreams["mic"]) { ctx.close(); return; }
            analyser.getByteFrequencyData(data);
            var sum = 0;
            for (var i = 0; i < data.length; i++) sum += data[i];
            var avg = sum / data.length;
            var pct = Math.min(100, (avg / 128) * 100);
            var meter = document.getElementById("mic-meter");
            if (meter) meter.style.width = pct + "%";
            activeStreams["mic-raf"] = requestAnimationFrame(draw);
          }
          draw();
        })
        .catch(function(e) {
          showResult("mic-result",
            "<b>DENIED</b><br>" + e.name + ": " + e.message +
            "<br><small>Check macOS System Settings &gt; Privacy &gt; Microphone</small>",
            "denied"
          );
        });
    }

    // ── Popup ──
    function testPopup() {
      var w = window.open("https://example.com", "_blank");
      if (!w) {
        showResult("popup-result",
          "<b>BLOCKED</b><br>window.open() returned null",
          "blocked"
        );
      } else {
        w.close();
        showResult("popup-result",
          "<b>OPENED</b> (unexpected!)",
          "granted"
        );
      }
    }

    // ── Camera + Mic ──
    function testCameraMic() {
      stopStream("cameramic", "cameramic-result");
      showResult("cameramic-result", "Requesting camera + microphone...", "granted");
      navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then(function(stream) {
          activeStreams["cameramic"] = stream;
          showResult("cameramic-result",
            '<video id="cameramic-video" autoplay playsinline muted></video>' +
            '<div style="margin-top:6px">Audio:</div>' +
            '<div class="meter-bar"><div class="meter-fill" id="cameramic-meter"></div></div>' +
            '<button class="stop-btn" onclick="event.stopPropagation(); stopStream(\\'cameramic\\', \\'cameramic-result\\')">Stop</button>',
            "granted"
          );
          document.getElementById("cameramic-video").srcObject = stream;
          // Volume meter for audio track
          var ctx = new AudioContext();
          var src = ctx.createMediaStreamSource(stream);
          var analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          src.connect(analyser);
          var data = new Uint8Array(analyser.frequencyBinCount);
          function draw() {
            if (!activeStreams["cameramic"]) { ctx.close(); return; }
            analyser.getByteFrequencyData(data);
            var sum = 0;
            for (var i = 0; i < data.length; i++) sum += data[i];
            var avg = sum / data.length;
            var pct = Math.min(100, (avg / 128) * 100);
            var meter = document.getElementById("cameramic-meter");
            if (meter) meter.style.width = pct + "%";
            activeStreams["cameramic-raf"] = requestAnimationFrame(draw);
          }
          draw();
        })
        .catch(function(e) {
          showResult("cameramic-result",
            "<b>DENIED</b><br>" + e.name + ": " + e.message +
            "<br><small>Check macOS System Settings &gt; Privacy</small>",
            "denied"
          );
        });
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

console.log("[Bun] Sandbox demo created. Close the window to exit.");
console.log("[Bun] Permission configuration:");
console.log(`[Bun]   allowCamera: ${allowCamera}`);
console.log(`[Bun]   allowMicrophone: ${allowMicrophone}`);
console.log(`[Bun]   allowFileSystem: ${allowFileSystem}`);
console.log("[Bun]   Popups: always blocked");
