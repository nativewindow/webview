import { createWindow } from "@nativewindow/ipc";

const ch = createWindow(
  {
    title: "Advanced Demo",
    width: 1024,
    height: 768,
    decorations: true,
    devtools: true,
  },
  {
    injectClient: false,
    schemas: { host: {}, client: {} },
    onValidationError: (type, payload) => {
      console.warn(`[Bun] Invalid "${type}" payload:`, payload);
    },
    maxMessageSize: 512 * 1024, // 512 KB — drop oversized payloads
    rateLimit: 10, // max 100 incoming messages per second
    maxListenersPerEvent: 10, // cap listeners to detect leaks early
  },
);

ch.window.onPageLoad((page) => {
  console.log(`[Bun] Page loaded, ${page}`);
});

ch.window.onClose(() => {
  console.log("[Bun] Window closed");
  process.exit(0);
});

const waitUntilAuthenticated = async () => {
  console.log("[Bun] Waiting for session_id cookie...");
  while (true) {
    const cookies = await ch.window.getCookies();
    if (cookies.some((it) => it.name === "ltoken_v2")) {
      console.log("[Bun] session_id cookie found, proceeding.");
      console.log(cookies.map((it) => it.name));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
};

ch.window.loadUrl("https://act.hoyolab.com/app/community-game-records-sea/index.html#/ys");

waitUntilAuthenticated().then(() => {
  console.log("[Bun] Authenticated!");
});

console.log("[Bun] Advanced Demo window created. Close the window to exit.");
