/// Unified cross-platform implementation using tao (windowing) + wry (webview).
///
/// Replaces the platform-specific `macos.rs` and `windows.rs` modules with a
/// single implementation that works on macOS, Windows, and Linux.
use std::borrow::Cow;
use std::collections::HashMap;

use tao::dpi::{LogicalPosition, LogicalSize};
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoop};
use tao::platform::run_return::EventLoopExtRunReturn;
use tao::window::{Window, WindowBuilder};

#[cfg(target_os = "linux")]
use wry::WebViewBuilderExtUnix;
#[cfg(target_os = "windows")]
use wry::WebViewBuilderExtWindows;
use wry::{WebView, WebViewBuilder};

use crate::events::WindowEventHandlers;
use crate::options::WindowOptions;
use crate::window_manager::{
    Command, EVENT_LOOP, MAX_PENDING_EVENTS, PENDING_BLURS, PENDING_CLOSES, PENDING_COOKIES,
    PENDING_FOCUSES, PENDING_MESSAGES, PENDING_MOVES, PENDING_NAVIGATION_BLOCKED,
    PENDING_PAGE_LOADS, PENDING_RESIZE_CALLBACKS, PENDING_TITLE_CHANGES, is_host_allowed,
    is_origin_trusted, json_escape,
};

/// Maximum IPC message size (10 MB).
const MAX_MESSAGE_SIZE: usize = 10 * 1024 * 1024;

/// Maximum pending IPC messages per window before new messages are dropped.
const MAX_PENDING_MESSAGES_PER_WINDOW: usize = 10_000;

/// Push an item to a thread-local pending buffer, enforcing MAX_PENDING_EVENTS.
/// Silently drops the item (with a one-time warning) if the buffer is full.
macro_rules! capped_push {
    ($tls:ident, $item:expr, $label:expr) => {
        $tls.with(|p| {
            let mut buf = p.borrow_mut();
            if buf.len() >= MAX_PENDING_EVENTS {
                // Only warn once per overflow (first drop)
                if buf.len() == MAX_PENDING_EVENTS {
                    eprintln!(
                        "[native-window] {} buffer full ({} entries), dropping events.",
                        $label, MAX_PENDING_EVENTS
                    );
                }
                return;
            }
            buf.push($item);
        });
    };
}

/// Returns the URL for the custom protocol handler.
///
/// On macOS/Linux, this is `nativewindow://localhost/` (native custom scheme).
/// On Windows, `with_https_scheme(true)` maps the custom protocol to
/// `https://nativewindow.localhost/`, and wry's `load_url()` does NOT
/// perform this translation at runtime — only the builder's `with_url()`
/// does. So we must use the HTTPS-mapped URL directly on Windows.
fn custom_protocol_url() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "https://nativewindow.localhost/"
    }
    #[cfg(not(target_os = "windows"))]
    {
        "nativewindow://localhost/"
    }
}

/// Load a window icon from a PNG or ICO file path.
///
/// ICO files: the entry with the highest color depth and largest size
/// is automatically selected by the image decoder.
/// Relative paths are resolved against the process working directory.
///
/// On macOS this is a no-op (macOS doesn't support per-window icons).
#[cfg(not(target_os = "macos"))]
fn load_icon_from_path(path: &str) -> napi::Result<tao::window::Icon> {
    let img = image::open(path)
        .map_err(|e| napi::Error::from_reason(format!("Failed to load icon '{}': {}", path, e)))?;
    let rgba = img.into_rgba8();
    let (width, height) = rgba.dimensions();
    let pixels = rgba.into_raw();
    tao::window::Icon::from_rgba(pixels, width, height)
        .map_err(|e| napi::Error::from_reason(format!("Failed to create icon: {}", e)))
}

// ── Types ──────────────────────────────────────────────────────

/// A window + webview pair managed by the platform.
struct WindowEntry {
    window: Window,
    webview: WebView,
}

/// Unified platform state backed by tao + wry.
pub struct Platform {
    windows: HashMap<u32, WindowEntry>,
    /// Reverse map: tao WindowId → our u32 window ID.
    window_id_map: HashMap<tao::window::WindowId, u32>,
    /// macOS only: tracks whether we promoted the app to Regular activation
    /// policy (showing the Dock icon). Used to demote back to Accessory once
    /// the last window closes.
    #[cfg(target_os = "macos")]
    dock_visible: bool,
}

// ── Platform initialization ────────────────────────────────────

impl Platform {
    /// Create a new platform instance and initialize the tao event loop.
    pub fn new() -> napi::Result<Self> {
        let event_loop = EventLoop::new();

        // On macOS, set up the Edit menu so Cmd+C/V/X/A/Z work in the webview.
        #[cfg(target_os = "macos")]
        setup_macos_menu();

        EVENT_LOOP.with(|el| {
            *el.borrow_mut() = Some(event_loop);
        });

        Ok(Self {
            windows: HashMap::new(),
            window_id_map: HashMap::new(),
            #[cfg(target_os = "macos")]
            dock_visible: false,
        })
    }

    // ── Command processing ─────────────────────────────────────

    /// Process a single command from the command queue.
    pub fn process_command(
        &mut self,
        cmd: Command,
        _event_handlers: &mut HashMap<u32, WindowEventHandlers>,
    ) -> napi::Result<()> {
        match cmd {
            Command::CreateWindow { id, options } => {
                self.create_window(id, &options)?;
            }
            Command::LoadURL { id, url } => {
                if let Some(entry) = self.windows.get(&id) {
                    entry
                        .webview
                        .load_url(&url)
                        .map_err(|e| napi::Error::from_reason(format!("load_url failed: {}", e)))?;
                    // Clear any stored HTML to prevent stale custom protocol responses
                    crate::window_manager::remove_html_content(id);
                }
            }
            Command::LoadHTML { id, html } => {
                if let Some(entry) = self.windows.get(&id) {
                    // Store HTML for the custom protocol handler, then navigate
                    // to the custom protocol URL which triggers the handler.
                    // This gives the page a proper origin (secure context) and
                    // makes Cmd+R / browser-native reload work correctly.
                    crate::window_manager::set_html_content(id, html);
                    entry.webview.load_url(custom_protocol_url()).map_err(|e| {
                        napi::Error::from_reason(format!("load_url (html) failed: {}", e))
                    })?;
                }
            }
            Command::EvaluateJS { id, script } => {
                if let Some(entry) = self.windows.get(&id) {
                    let _ = entry.webview.evaluate_script(&script);
                }
            }
            Command::SetTitle { id, title } => {
                if let Some(entry) = self.windows.get(&id) {
                    entry.window.set_title(&title);
                }
            }
            Command::SetSize { id, width, height } => {
                if let Some(entry) = self.windows.get(&id) {
                    entry.window.set_inner_size(LogicalSize::new(width, height));
                }
            }
            Command::SetMinSize { id, width, height } => {
                if let Some(entry) = self.windows.get(&id) {
                    entry
                        .window
                        .set_min_inner_size(Some(LogicalSize::new(width, height)));
                }
            }
            Command::SetMaxSize { id, width, height } => {
                if let Some(entry) = self.windows.get(&id) {
                    entry
                        .window
                        .set_max_inner_size(Some(LogicalSize::new(width, height)));
                }
            }
            Command::SetPosition { id, x, y } => {
                if let Some(entry) = self.windows.get(&id) {
                    entry.window.set_outer_position(LogicalPosition::new(x, y));
                }
            }
            Command::SetResizable { id, resizable } => {
                if let Some(entry) = self.windows.get(&id) {
                    entry.window.set_resizable(resizable);
                }
            }
            Command::SetDecorations { id, decorations } => {
                if let Some(entry) = self.windows.get(&id) {
                    entry.window.set_decorations(decorations);
                }
            }
            Command::SetAlwaysOnTop { id, always_on_top } => {
                if let Some(entry) = self.windows.get(&id) {
                    entry.window.set_always_on_top(always_on_top);
                }
            }
            Command::Show { id } => {
                if let Some(entry) = self.windows.get(&id) {
                    entry.window.set_visible(true);
                }
            }
            Command::Hide { id } => {
                if let Some(entry) = self.windows.get(&id) {
                    entry.window.set_visible(false);
                }
            }
            Command::Close { id } => {
                self.destroy_window_entry(id);
                // Event handlers are NOT removed here — they are cleaned
                // up after flush_pending_callbacks so the JS on_close
                // callback still fires.
                capped_push!(PENDING_CLOSES, id, "PENDING_CLOSES");
            }
            Command::Focus { id } => {
                if let Some(entry) = self.windows.get(&id) {
                    entry.window.set_focus();
                }
            }
            Command::Maximize { id } => {
                if let Some(entry) = self.windows.get(&id) {
                    entry.window.set_maximized(true);
                }
            }
            Command::Minimize { id } => {
                if let Some(entry) = self.windows.get(&id) {
                    entry.window.set_minimized(true);
                }
            }
            Command::Unmaximize { id } => {
                if let Some(entry) = self.windows.get(&id) {
                    entry.window.set_maximized(false);
                }
            }
            Command::Reload { id } => {
                if let Some(entry) = self.windows.get(&id) {
                    // With the custom protocol, reload() works correctly for both
                    // URL and HTML content — HTML pages are at nativewindow://localhost/
                    // so the browser re-requests the protocol handler on reload.
                    if let Err(e) = entry.webview.reload() {
                        eprintln!("[native-window] Reload failed: {}", e);
                    }
                }
            }
            Command::GetCookies { id, url } => {
                if let Some(entry) = self.windows.get(&id) {
                    let json = match &url {
                        Some(u) => match entry.webview.cookies_for_url(u) {
                            Ok(cookies) => serialize_cookies(&cookies),
                            Err(_) => "[]".to_string(),
                        },
                        None => match entry.webview.cookies() {
                            Ok(cookies) => serialize_cookies(&cookies),
                            Err(_) => "[]".to_string(),
                        },
                    };
                    PENDING_COOKIES.with(|p| {
                        // Cookies always push — getCookies() promises need a response.
                        p.borrow_mut().push((id, json));
                    });
                }
            }
            Command::ClearCookies { id, host } => {
                if let Some(entry) = self.windows.get(&id) {
                    let cookies = match entry.webview.cookies() {
                        Ok(all) => match &host {
                            Some(h) => {
                                let h_lower = h.to_lowercase();
                                all.into_iter()
                                    .filter(|c| {
                                        c.domain()
                                            .map(|d| {
                                                let d = d.trim_start_matches('.').to_lowercase();
                                                d == h_lower
                                                    || h_lower.ends_with(&format!(".{}", d))
                                            })
                                            .unwrap_or(false)
                                    })
                                    .collect::<Vec<_>>()
                            }
                            None => all,
                        },
                        Err(_) => Vec::new(),
                    };
                    for cookie in &cookies {
                        let _ = entry.webview.delete_cookie(cookie);
                    }
                }
            }
            Command::SetIcon { id, path } => {
                // macOS doesn't support per-window icons; silently ignore.
                let _ = (&id, &path);
                #[cfg(not(target_os = "macos"))]
                if let Some(entry) = self.windows.get(&id) {
                    match load_icon_from_path(&path) {
                        Ok(icon) => {
                            entry.window.set_window_icon(Some(icon));
                        }
                        Err(e) => eprintln!("[native-window] Warning: {}", e),
                    }
                }
            }
            Command::OpenDevTools { id } => {
                if let Some(entry) = self.windows.get(&id) {
                    entry.webview.open_devtools();
                }
            }
            Command::CloseDevTools { id } => {
                if let Some(entry) = self.windows.get(&id) {
                    entry.webview.close_devtools();
                }
            }
        }
        Ok(())
    }

    // ── Devtools query ────────────────────────────────────────────

    /// Check whether the devtools panel is currently open for a window.
    /// Returns `None` if the window does not exist.
    pub fn is_devtools_open(&self, id: u32) -> Option<bool> {
        self.windows
            .get(&id)
            .map(|entry| entry.webview.is_devtools_open())
    }

    // ── Window destruction ──────────────────────────────────────

    /// Remove and destroy a window's native resources (tao Window + wry
    /// WebView) and clean up associated platform state.  Does NOT touch
    /// `event_handlers` — those must survive until after
    /// `flush_pending_callbacks` so the JS `on_close` callback still fires.
    ///
    /// Returns `true` if the window existed and was destroyed.
    fn destroy_window_entry(&mut self, id: u32) -> bool {
        if let Some(entry) = self.windows.remove(&id) {
            let tao_id = entry.window.id();
            self.window_id_map.remove(&tao_id);
            // Drop entry — this closes the window and destroys the webview
            drop(entry);
            // Clean up security config
            crate::window_manager::TRUSTED_ORIGINS_MAP.with(|o| {
                o.borrow_mut().remove(&id);
            });
            crate::window_manager::ALLOWED_HOSTS_MAP.with(|h| {
                h.borrow_mut().remove(&id);
            });
            crate::window_manager::PERMISSIONS_MAP.with(|p| {
                p.borrow_mut().remove(&id);
            });
            crate::window_manager::remove_html_content(id);
            true
        } else {
            false
        }
    }

    /// Destroy native resources for windows that received an OS-initiated
    /// `CloseRequested` but weren't already destroyed by `Command::Close`.
    ///
    /// This ensures the tao Window and wry WebView are properly dropped
    /// **before** the JS `on_close` callback fires.  Without this, an
    /// abrupt `process.exit()` in the callback leaves live native objects
    /// whose teardown fails (e.g. WebView2 "Failed to unregister class"
    /// on Windows).
    pub fn destroy_pending_closes(&mut self) {
        PENDING_CLOSES.with(|p| {
            let pending = p.borrow();
            for &id in pending.iter() {
                // No-op if already destroyed by Command::Close
                self.destroy_window_entry(id);
            }
        });
    }

    // ── Window creation ────────────────────────────────────────

    /// Create a new tao window + wry webview.
    fn create_window(&mut self, id: u32, options: &WindowOptions) -> napi::Result<()> {
        EVENT_LOOP.with(|el| {
            let el_ref = el.borrow();
            let event_loop = el_ref.as_ref().ok_or_else(|| {
                napi::Error::from_reason("Event loop not initialized")
            })?;

            // ── On macOS: promote to Regular activation policy when first window opens ──
            // This makes the Dock icon appear while a window is visible.
            #[cfg(target_os = "macos")]
            if !self.dock_visible {
                set_macos_activation_policy_regular();
                self.dock_visible = true;
            }

            // ── Build the tao window ───────────────────────────
            let width = options.width.unwrap_or(800.0);
            let height = options.height.unwrap_or(600.0);

            let mut win_builder = WindowBuilder::new()
                .with_title(options.title.as_deref().unwrap_or(""))
                .with_inner_size(LogicalSize::new(width, height))
                .with_resizable(options.resizable.unwrap_or(true))
                .with_decorations(options.decorations.unwrap_or(true))
                .with_always_on_top(options.always_on_top.unwrap_or(false))
                .with_visible(options.visible.unwrap_or(true));

            if let (Some(x), Some(y)) = (options.x, options.y) {
                win_builder = win_builder.with_position(LogicalPosition::new(x, y));
            }
            if let (Some(min_w), Some(min_h)) = (options.min_width, options.min_height) {
                win_builder = win_builder.with_min_inner_size(LogicalSize::new(min_w, min_h));
            }
            if let (Some(max_w), Some(max_h)) = (options.max_width, options.max_height) {
                win_builder = win_builder.with_max_inner_size(LogicalSize::new(max_w, max_h));
            }
            if options.transparent.unwrap_or(false) {
                win_builder = win_builder.with_transparent(true);
            }

            let window = win_builder.build(event_loop)
                .map_err(|e| napi::Error::from_reason(format!("Failed to create window: {}", e)))?;

            // Set window icon from file path (Windows/Linux only; no-op on macOS)
            #[cfg(not(target_os = "macos"))]
            if let Some(ref icon_path) = options.icon {
                match load_icon_from_path(icon_path) {
                    Ok(icon) => { window.set_window_icon(Some(icon)); }
                    Err(e) => eprintln!("[native-window] Warning: {}", e),
                }
            }

            // ── Build the wry webview ──────────────────────────
            let window_id = id; // Capture for closures

            let mut wv_builder = WebViewBuilder::new()
                .with_devtools(options.devtools.unwrap_or(false))
                .with_transparent(options.transparent.unwrap_or(false))
                .with_visible(options.visible.unwrap_or(true))
                .with_incognito(options.incognito.unwrap_or(false));

            // IPC handler — receives messages from window.ipc.postMessage()
            wv_builder = wv_builder.with_ipc_handler(move |req: http::Request<String>| {
                let message = req.body().clone();
                if message.len() > MAX_MESSAGE_SIZE {
                    return;
                }
                let source_url = req.uri().to_string();

                if !is_origin_trusted(window_id, &source_url) {
                    return;
                }

                PENDING_MESSAGES.with(|p| {
                    let mut buf = p.borrow_mut();
                    let count = buf.iter().filter(|(id, _, _)| *id == window_id).count();
                    if count >= MAX_PENDING_MESSAGES_PER_WINDOW {
                        eprintln!(
                            "[native-window] Window {}: pending IPC message cap ({}) reached, dropping message.",
                            window_id, MAX_PENDING_MESSAGES_PER_WINDOW
                        );
                        return;
                    }
                    buf.push((window_id, message, source_url));
                });
            });

            // JS-level dangerous-scheme blocking — patches to prevent data:, file:,
            // and blob: URIs from executing in the webview via DOM element
            // properties, anchor clicks, and dynamic element injection.
            //
            // NOTE: javascript: is intentionally NOT blocked here. It can only be
            // triggered by code already running in the webview (client-side JS),
            // so blocking it adds no security value. On WebView2 (Chromium),
            // Location.prototype is non-configurable at the C++ level, making
            // JS-level interception impossible anyway. javascript: is still
            // blocked by the native navigation handler (macOS/Linux) and the
            // Rust loadUrl() allowlist (all platforms).
            //
            // Each section is wrapped in its own try/catch so that a failure
            // in one patch never disables subsequent protections.
            wv_builder = wv_builder.with_initialization_script(
                r#"(function () {
  var BLOCKED_SCHEMES = ["data:", "file:", "blob:"];

  function isBlocked(url) {
    var lower = (url + "").trim().toLowerCase();
    return BLOCKED_SCHEMES.some(function (scheme) {
      return lower.startsWith(scheme);
    });
  }

  // Helper: try to redefine an accessor property on a target object.
  // Returns true on success, false if the property is non-configurable.
  function tryPatchAccessor(target, prop, wrapSet) {
    try {
      var d = Object.getOwnPropertyDescriptor(target, prop);
      if (d && d.set) {
        var orig = d.set;
        Object.defineProperty(target, prop, {
          set: wrapSet(orig),
          get: d.get,
          enumerable: d.enumerable,
          configurable: d.configurable,
        });
        return true;
      }
    } catch (e) {}
    return false;
  }

  // Helper: try to redefine a data (method) property via defineProperty.
  // Direct assignment (proto.method = fn) silently fails when writable is false.
  function tryPatchMethod(target, prop, wrapFn) {
    try {
      var d = Object.getOwnPropertyDescriptor(target, prop);
      if (d && typeof d.value === "function") {
        var orig = d.value;
        Object.defineProperty(target, prop, {
          value: wrapFn(orig),
          writable: d.writable,
          enumerable: d.enumerable,
          configurable: d.configurable,
        });
        return true;
      }
    } catch (e) {}
    return false;
  }

  // ---- Location patches (href setter) ----
  // On Chromium/WebView2, Location.prototype.href is configurable: false,
  // so the first attempt throws. We try multiple levels:
  //   1. Location.prototype
  //   2. Object.getPrototypeOf(location) (may differ from Location.prototype)
  //   3. Own property on the location instance itself
  var hrefWrap = function (orig) {
    return function (value) {
      if (!isBlocked(value)) orig.call(this, value);
    };
  };
  if (!tryPatchAccessor(Location.prototype, "href", hrefWrap)) {
    try {
      var locProto = Object.getPrototypeOf(location);
      if (locProto && locProto !== Location.prototype) {
        tryPatchAccessor(locProto, "href", hrefWrap);
      }
    } catch (e) {}
    // Last resort: try defining an own property on the location instance.
    try {
      var ld = Object.getOwnPropertyDescriptor(location, "href")
            || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(location), "href");
      if (ld && ld.set) {
        var origLocSet = ld.set;
        Object.defineProperty(location, "href", {
          set: function (value) {
            if (!isBlocked(value)) origLocSet.call(this, value);
          },
          get: ld.get,
          enumerable: true,
          configurable: true,
        });
      }
    } catch (e) {}
  }

  // ---- Location patches (assign / replace) ----
  // Use defineProperty instead of direct assignment — direct assignment
  // silently fails when the property is non-writable on Chromium.
  var assignWrap = function (orig) {
    return function (url) {
      if (!isBlocked(url)) orig.call(this, url);
    };
  };
  tryPatchMethod(Location.prototype, "assign", assignWrap);
  tryPatchMethod(Location.prototype, "replace", assignWrap);

  // ---- Click listener for <a>/<area> with blocked-scheme hrefs ----
  // Capturing phase so it fires before any page-level handlers.
  // Walks up the DOM to handle clicks on child elements inside anchors.
  try {
    document.addEventListener("click", function (e) {
      var t = e.target;
      while (t && t !== document) {
        if ((t.tagName === "A" || t.tagName === "AREA") && t.href && isBlocked(t.href)) {
          e.preventDefault();
          e.stopImmediatePropagation();
          return;
        }
        t = t.parentElement;
      }
    }, true);
  } catch (e) {}

  // ---- DOM property setter patches ----
  // Block setting dangerous-scheme URLs on element properties that
  // can trigger navigation or script execution.
  var setterWrap = function (orig) {
    return function (v) { if (!isBlocked(v)) orig.call(this, v); };
  };
  try { tryPatchAccessor(HTMLAnchorElement.prototype, "href", setterWrap); } catch (e) {}
  try { tryPatchAccessor(HTMLAreaElement.prototype, "href", setterWrap); } catch (e) {}
  try { tryPatchAccessor(HTMLIFrameElement.prototype, "src", setterWrap); } catch (e) {}
  try { tryPatchAccessor(HTMLFormElement.prototype, "action", setterWrap); } catch (e) {}

  // ---- MutationObserver for dynamically injected elements ----
  // Sanitizes elements added via innerHTML, insertAdjacentHTML, etc.
  try {
    function sanitize(el) {
      var tag = el.tagName;
      if ((tag === "A" || tag === "AREA") && el.hasAttribute("href") && isBlocked(el.getAttribute("href"))) {
        el.removeAttribute("href");
      } else if (tag === "IFRAME" && el.hasAttribute("src") && isBlocked(el.getAttribute("src"))) {
        el.removeAttribute("src");
      } else if (tag === "FORM" && el.hasAttribute("action") && isBlocked(el.getAttribute("action"))) {
        el.removeAttribute("action");
      }
    }
    var root = document.documentElement || document;
    new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        m.addedNodes.forEach(function (n) {
          if (n.nodeType === 1) {
            sanitize(n);
            if (n.querySelectorAll) {
              n.querySelectorAll("a[href],area[href],iframe[src],form[action]").forEach(sanitize);
            }
          }
        });
      });
    }).observe(root, { childList: true, subtree: true });
  } catch (e) {}
})();"#
            );

            // Navigation handler — block dangerous schemes + enforce allowedHosts
            wv_builder = wv_builder.with_navigation_handler(move |url: String| {
                let lower = url.to_lowercase();
                // Always allow our custom protocol for HTML content.
                // macOS: nativewindow://localhost/, Windows: https://nativewindow.localhost/
                if lower.starts_with("nativewindow:") {
                    return true;
                }
                // Check host component specifically (not a substring match)
                if let Ok(parsed) = url::Url::parse(&url)
                    && parsed.host_str() == Some("nativewindow.localhost")
                {
                    return true;
                }
                // Block dangerous URL schemes
                if lower.starts_with("javascript:")
                    || lower.starts_with("file:")
                    || lower.starts_with("data:")
                    || lower.starts_with("blob:")
                {
                    return false;
                }
                // Enforce allowedHosts
                if !is_host_allowed(window_id, &url) {
                    capped_push!(PENDING_NAVIGATION_BLOCKED, (window_id, url), "PENDING_NAVIGATION_BLOCKED");
                    return false;
                }
                true
            });

            // Page load handler — fires on navigation start and finish
            wv_builder = wv_builder.with_on_page_load_handler(move |event, url| {
                let event_str = match event {
                    wry::PageLoadEvent::Started => "started".to_string(),
                    wry::PageLoadEvent::Finished => "finished".to_string(),
                };
                PENDING_PAGE_LOADS.with(|p| {
                    let mut buf = p.borrow_mut();
                    if buf.len() < MAX_PENDING_EVENTS {
                        buf.push((window_id, event_str, url));
                    }
                });
            });

            // Title changed handler
            wv_builder = wv_builder.with_document_title_changed_handler(move |title| {
                capped_push!(PENDING_TITLE_CHANGES, (window_id, title), "PENDING_TITLE_CHANGES");
            });

            // Custom protocol handler — serves stored HTML content at nativewindow://localhost/
            // This gives HTML pages a proper origin (secure context) so APIs like
            // navigator.mediaDevices are available, and makes browser-native reload
            // (Cmd+R) work correctly instead of showing a blank page.
            wv_builder = wv_builder.with_custom_protocol("nativewindow".into(), move |_webview_id, _request| {
                let html = crate::window_manager::get_html_content(window_id)
                    .unwrap_or_default();
                http::Response::builder()
                    .header("Content-Type", "text/html; charset=utf-8")
                    .header("Cache-Control", "no-store")
                    .body(Cow::Owned(html.into_bytes()))
                    .unwrap_or_else(|_| {
                        http::Response::builder()
                            .body(Cow::Owned(Vec::new()))
                            .expect("empty fallback response")
                    })
            });

            // Block popups (window.open)
            wv_builder = wv_builder.with_new_window_req_handler(move |_url, _features| {
                wry::NewWindowResponse::Deny
            });

            // CSP injection via initialization script.
            // Uses json_escape() to safely embed the CSP value as a JSON string,
            // preventing injection via newlines, quotes, null bytes, etc.
            //
            if let Some(ref csp) = options.csp {
                let safe_csp = crate::window_manager::json_escape(csp);
                let csp_script = format!(
                    "\
document.addEventListener('DOMContentLoaded', function () {{
  var meta = document.createElement('meta');
  meta.httpEquiv = 'Content-Security-Policy';
  meta.content = {};
  document.head.insertBefore(meta, document.head.firstChild);
}}, {{ once: true }});",
                    safe_csp
                );
                wv_builder = wv_builder.with_initialization_script(&csp_script);
            }

            // Permission flags — wry does not expose permission delegates, so
            // camera/mic/filesystem flags cannot be enforced. Log a warning if
            // the user explicitly set any of these to make them aware.
            let perms = crate::window_manager::get_permissions(id);
            if perms.allow_camera {
                eprintln!(
                    "[native-window] Window {}: allowCamera is set but not enforced by the wry backend. \
                     The OS default (user prompt) applies.",
                    id
                );
            }
            if perms.allow_microphone {
                eprintln!(
                    "[native-window] Window {}: allowMicrophone is set but not enforced by the wry backend. \
                     The OS default (user prompt) applies.",
                    id
                );
            }
            if perms.allow_file_system {
                eprintln!(
                    "[native-window] Window {}: allowFileSystem is set but not enforced by the wry backend. \
                     The OS default applies.",
                    id
                );
            }

            // On Windows, map the custom protocol to https:// for secure context.
            // This makes nativewindow://localhost/ → https://nativewindow.localhost/
            // so APIs requiring secure context (crypto, mediaDevices, etc.) work.
            #[cfg(target_os = "windows")]
            {
                wv_builder = wv_builder.with_https_scheme(true);
            }

            // Build the webview — platform-specific build method
            #[cfg(target_os = "linux")]
            let webview = {
                use tao::platform::unix::WindowExtUnix;
                let gtk_window = window.gtk_window();
                wv_builder.build_gtk(gtk_window)
                    .map_err(|e| napi::Error::from_reason(format!("Failed to create webview: {}", e)))?
            };

            #[cfg(not(target_os = "linux"))]
            let webview = wv_builder.build(&window)
                .map_err(|e| napi::Error::from_reason(format!("Failed to create webview: {}", e)))?;

            // Store the window + webview
            let tao_window_id = window.id();
            self.window_id_map.insert(tao_window_id, id);
            self.windows.insert(id, WindowEntry {
                window,
                webview,
            });

            Ok(())
        })
    }

    // ── Event loop pumping ─────────────────────────────────────

    /// Pump the tao event loop (non-blocking). Processes all pending OS events
    /// and pushes them to PENDING_* deferred callback buffers.
    ///
    /// Uses a two-phase approach:
    /// - Phase A: `run_return` dispatches tao-level events (WindowEvent, etc.)
    /// - Phase B (macOS): raw NSApp event drain for cascading WebKit events
    ///
    /// Phase B is needed because tao's `run_return` processes one CFRunLoop
    /// iteration via `[NSApp run]`, but WebKit operations (network → parse →
    /// render) generate cascading events that need additional iterations.
    /// Without the drain, each step waits 16ms for the next pump call.
    pub fn pump_events(&mut self) {
        // Phase A: tao event dispatch
        EVENT_LOOP.with(|el| {
            let mut event_loop_opt = el.borrow_mut().take();
            if let Some(ref mut event_loop) = event_loop_opt {
                let window_id_map = &self.window_id_map;
                let windows = &self.windows;

                event_loop.run_return(|event, _target, control_flow| {
                    // Ensure non-blocking from the start, regardless of any
                    // stale ControlFlow persisted in tao's global Handler.
                    *control_flow = ControlFlow::Poll;

                    match event {
                        Event::WindowEvent {
                            window_id,
                            event: ref win_event,
                            ..
                        } => {
                            if let Some(&id) = window_id_map.get(&window_id) {
                                match win_event {
                                    WindowEvent::Resized(size) => {
                                        let scale = windows
                                            .get(&id)
                                            .map(|e| e.window.scale_factor())
                                            .unwrap_or(1.0);
                                        let logical: LogicalSize<f64> = size.to_logical(scale);
                                        capped_push!(
                                            PENDING_RESIZE_CALLBACKS,
                                            (id, logical.width, logical.height),
                                            "PENDING_RESIZE_CALLBACKS"
                                        );
                                    }
                                    WindowEvent::Moved(pos) => {
                                        let scale = windows
                                            .get(&id)
                                            .map(|e| e.window.scale_factor())
                                            .unwrap_or(1.0);
                                        let logical: LogicalPosition<f64> = pos.to_logical(scale);
                                        capped_push!(
                                            PENDING_MOVES,
                                            (id, logical.x, logical.y),
                                            "PENDING_MOVES"
                                        );
                                    }
                                    WindowEvent::Focused(focused) => {
                                        if *focused {
                                            capped_push!(PENDING_FOCUSES, id, "PENDING_FOCUSES");
                                        } else {
                                            capped_push!(PENDING_BLURS, id, "PENDING_BLURS");
                                        }
                                    }
                                    WindowEvent::CloseRequested => {
                                        capped_push!(PENDING_CLOSES, id, "PENDING_CLOSES");
                                    }
                                    _ => {}
                                }
                            }
                        }
                        Event::MainEventsCleared => {
                            *control_flow = ControlFlow::Exit;
                        }
                        _ => {}
                    }
                });
            }
            // Put the event loop back
            *el.borrow_mut() = event_loop_opt;
        });

        // Phase B: drain remaining platform events for WebKit processing
        #[cfg(target_os = "macos")]
        self.drain_macos_events();

        // Phase C (macOS): demote back to Accessory activation policy when the
        // last window has closed. Doing this here — after the event loop has
        // fully processed — ensures NSApp's internal window list is empty
        // before we change the policy. Calling setActivationPolicy inside
        // destroy_window_entry (synchronously during window drop) is too early:
        // NSApp hasn't yet removed the closing NSWindow from its window list,
        // so the call silently fails and the Dock icon remains.
        #[cfg(target_os = "macos")]
        if self.dock_visible && self.windows.is_empty() {
            set_macos_activation_policy_accessory();
            self.dock_visible = false;
        }
    }

    /// Drain remaining events and run-loop sources after `run_return`.
    ///
    /// WebKit (WKWebView) relies on **both** NSApp events and CFRunLoop
    /// sources (GCD dispatch queues, Mach port notifications) for internal
    /// processing.  tao's `run_return` processes one event-loop iteration
    /// then exits via `[NSApp stop:]`, leaving pending CFRunLoop sources
    /// unprocessed.  The previous implementation only drained NSApp events
    /// via `nextEventMatchingMask:distantPast`, which missed GCD/Mach-port
    /// callbacks entirely — causing 3-10 s content-rendering delays.
    ///
    /// This method alternates between:
    ///   1. Draining all immediately-available NSApp events (`sendEvent:`)
    ///   2. Processing one pending CFRunLoop source (`CFRunLoopRunInMode`)
    ///      …until both queues are empty.  CFRunLoop sources can generate NSApp
    ///      events and vice-versa, so alternating handles cascading work.
    #[cfg(target_os = "macos")]
    fn drain_macos_events(&self) {
        use objc2_app_kit::{NSApplication, NSEventMask};
        use objc2_foundation::{MainThreadMarker, NSDate, NSDefaultRunLoopMode};

        // Raw FFI to CoreFoundation for processing GCD/Mach-port sources.
        // CoreFoundation.framework is always linked on macOS — no extra dep.
        unsafe extern "C" {
            unsafe static kCFRunLoopDefaultMode: *const std::ffi::c_void;
            unsafe fn CFRunLoopRunInMode(
                mode: *const std::ffi::c_void,
                seconds: f64,
                return_after_source_handled: u8,
            ) -> i32;
        }
        /// `CFRunLoopRunInMode` return value when a source was dispatched.
        const K_CF_RUN_LOOP_RUN_HANDLED_SOURCE: i32 = 4;

        unsafe {
            let Some(mtm) = MainThreadMarker::new() else {
                eprintln!(
                    "[native-window] drain_macos_events called from non-main thread; skipping"
                );
                return;
            };
            let app = NSApplication::sharedApplication(mtm);

            loop {
                let mut did_work = false;

                // ── Phase 1: drain all immediately-available NSApp events ──
                loop {
                    let event = app.nextEventMatchingMask_untilDate_inMode_dequeue(
                        NSEventMask::Any,
                        Some(&NSDate::distantPast()),
                        NSDefaultRunLoopMode,
                        true,
                    );
                    match event {
                        Some(evt) => {
                            app.sendEvent(&evt);
                            did_work = true;
                        }
                        None => break,
                    }
                }

                // ── Phase 2: process one pending CFRunLoop source ──────────
                // (GCD dispatch blocks, Mach-port notifications, timers)
                let result = CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.0, 1);
                if result == K_CF_RUN_LOOP_RUN_HANDLED_SOURCE {
                    did_work = true;
                }

                if !did_work {
                    break;
                }
            }
        }
    }
}

// ── macOS activation policy helpers ───────────────────────────

/// Promote the app to Regular activation policy — shows the Dock icon and
/// enables the standard app menu bar. Called when the first native window is
/// about to be created so the window can receive focus normally.
#[cfg(target_os = "macos")]
fn set_macos_activation_policy_regular() {
    use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy};
    use objc2_foundation::MainThreadMarker;
    if let Some(mtm) = MainThreadMarker::new() {
        let app = NSApplication::sharedApplication(mtm);
        // Ignore the return value (false means policy was already Regular).
        app.setActivationPolicy(NSApplicationActivationPolicy::Regular);
    }
}

/// Demote the app back to Accessory activation policy — hides the Dock icon.
/// Called when the last native window is closed so long-running background
/// processes (e.g. Stream Deck plugins) do not leave a stale Dock entry.
#[cfg(target_os = "macos")]
fn set_macos_activation_policy_accessory() {
    use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy};
    use objc2_foundation::MainThreadMarker;
    if let Some(mtm) = MainThreadMarker::new() {
        let app = NSApplication::sharedApplication(mtm);
        app.setActivationPolicy(NSApplicationActivationPolicy::Accessory);
    }
}

// ── macOS Edit menu setup ──────────────────────────────────────

/// On macOS, set up the Edit menu so standard keyboard shortcuts
/// (Cmd+C, Cmd+V, Cmd+X, Cmd+A, Cmd+Z) work in the webview.
/// Tao creates the NSApplication but doesn't add an Edit menu.
#[cfg(target_os = "macos")]
fn setup_macos_menu() {
    use objc2::{MainThreadOnly, sel};
    use objc2_app_kit::{NSApplication, NSEventModifierFlags, NSMenu, NSMenuItem};
    use objc2_foundation::{MainThreadMarker, ns_string};

    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };

    let app = NSApplication::sharedApplication(mtm);

    // Get existing main menu or create a new one so we don't clobber
    // any items tao may have added (e.g. the app menu).
    let menu_bar = app.mainMenu().unwrap_or_else(|| NSMenu::new(mtm));

    // ---- Build the Edit submenu ----
    let edit_menu = NSMenu::initWithTitle(NSMenu::alloc(mtm), ns_string!("Edit"));

    // Safety: all selectors below are well-known standard NSResponder actions.
    unsafe {
        let undo = NSMenuItem::initWithTitle_action_keyEquivalent(
            NSMenuItem::alloc(mtm),
            ns_string!("Undo"),
            Some(sel!(undo:)),
            ns_string!("z"),
        );
        edit_menu.addItem(&undo);

        let redo = NSMenuItem::initWithTitle_action_keyEquivalent(
            NSMenuItem::alloc(mtm),
            ns_string!("Redo"),
            Some(sel!(redo:)),
            ns_string!("z"),
        );
        redo.setKeyEquivalentModifierMask(
            NSEventModifierFlags::Command | NSEventModifierFlags::Shift,
        );
        edit_menu.addItem(&redo);

        edit_menu.addItem(&NSMenuItem::separatorItem(mtm));

        let cut = NSMenuItem::initWithTitle_action_keyEquivalent(
            NSMenuItem::alloc(mtm),
            ns_string!("Cut"),
            Some(sel!(cut:)),
            ns_string!("x"),
        );
        edit_menu.addItem(&cut);

        let copy = NSMenuItem::initWithTitle_action_keyEquivalent(
            NSMenuItem::alloc(mtm),
            ns_string!("Copy"),
            Some(sel!(copy:)),
            ns_string!("c"),
        );
        edit_menu.addItem(&copy);

        let paste = NSMenuItem::initWithTitle_action_keyEquivalent(
            NSMenuItem::alloc(mtm),
            ns_string!("Paste"),
            Some(sel!(paste:)),
            ns_string!("v"),
        );
        edit_menu.addItem(&paste);

        let select_all = NSMenuItem::initWithTitle_action_keyEquivalent(
            NSMenuItem::alloc(mtm),
            ns_string!("Select All"),
            Some(sel!(selectAll:)),
            ns_string!("a"),
        );
        edit_menu.addItem(&select_all);
    }

    // ---- Attach Edit submenu to the menu bar ----
    let edit_item = NSMenuItem::new(mtm);
    edit_item.setSubmenu(Some(&edit_menu));
    menu_bar.addItem(&edit_item);

    app.setMainMenu(Some(&menu_bar));
}

// ── Cookie serialization ───────────────────────────────────────

/// Serialize a list of wry cookies to a JSON array string.
fn serialize_cookies(cookies: &[wry::cookie::Cookie<'static>]) -> String {
    // wry::CookieJar wraps cookie::Cookie
    let mut out = String::from("[");
    for (i, cookie_jar) in cookies.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        let name = json_escape(cookie_jar.name());
        let value = json_escape(cookie_jar.value());
        let domain = cookie_jar
            .domain()
            .map(json_escape)
            .unwrap_or_else(|| "\"\"".to_string());
        let path = cookie_jar
            .path()
            .map(json_escape)
            .unwrap_or_else(|| "\"/\"".to_string());
        let http_only = cookie_jar.http_only().unwrap_or(false);
        let secure = cookie_jar.secure().unwrap_or(false);
        let same_site = match cookie_jar.same_site() {
            Some(wry::cookie::SameSite::Strict) => "\"Strict\"",
            Some(wry::cookie::SameSite::Lax) => "\"Lax\"",
            Some(wry::cookie::SameSite::None) => "\"None\"",
            None => "null",
        };
        let expires = cookie_jar
            .expires()
            .and_then(|e| match e {
                wry::cookie::Expiration::DateTime(dt) => Some(format!("{}", dt.unix_timestamp())),
                wry::cookie::Expiration::Session => None,
            })
            .unwrap_or_else(|| "null".to_string());

        out.push_str(&format!(
            "{{\"name\":{},\"value\":{},\"domain\":{},\"path\":{},\"httpOnly\":{},\"secure\":{},\"sameSite\":{},\"expires\":{}}}",
            name, value, domain, path, http_only, secure, same_site, expires
        ));
    }
    out.push(']');
    out
}
