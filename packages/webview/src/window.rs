use napi::bindgen_prelude::*;
use napi_derive::napi;

use crate::events::{
    CloseCallback, FocusCallback, MessageCallback, MoveCallback, NavigationBlockedCallback,
    PageLoadCallback, ReloadCallback, ResizeCallback, TitleChangedCallback,
};
use crate::options::{CookieInfo, WindowOptions};
use crate::window_manager::{
    ALLOWED_HOSTS_MAP, Command, PERMISSIONS_MAP, PermissionFlags, TRUSTED_ORIGINS_MAP,
    extract_origin, is_url_scheme_allowed, with_manager,
};

/// A native OS window with an embedded webview.
#[napi]
pub struct NativeWindow {
    id: u32,
    closed: bool,
}

#[napi]
impl NativeWindow {
    /// Create a new native window with the given options.
    ///
    /// Automatically initializes the native subsystem on first call and
    /// starts the native event pump when the first window is created.
    /// The window is created asynchronously during the next `pumpEvents()` cycle.
    #[napi(constructor)]
    pub fn new(env: Env, options: Option<WindowOptions>) -> Result<Self> {
        let opts = options.unwrap_or_default();

        let (id, needs_pump) = with_manager(|mgr| -> napi::Result<(u32, bool)> {
            // Auto-init on first window creation
            if !mgr.initialized {
                mgr.platform = Some(crate::platform::Platform::new()?);
                mgr.initialized = true;
            }
            let id = mgr.allocate_id()?;
            // Store trusted origins for native-layer IPC filtering.
            // Normalize each origin through extract_origin() so that
            // user-provided values like "HTTPS://Example.Com:443" are
            // stored as "https://example.com" (WHATWG URL Standard).
            if let Some(ref origins) = opts.trusted_origins {
                let normalized: Vec<String> =
                    origins.iter().filter_map(|o| extract_origin(o)).collect();
                if !normalized.is_empty() {
                    TRUSTED_ORIGINS_MAP.with(|o| {
                        o.borrow_mut().insert(id, normalized);
                    });
                }
            }
            // Store allowed hosts for navigation restriction
            // (separate thread-local so macOS delegates can read while MANAGER is borrowed)
            if let Some(ref hosts) = opts.allowed_hosts
                && !hosts.is_empty()
            {
                ALLOWED_HOSTS_MAP.with(|h| {
                    h.borrow_mut().insert(id, hosts.clone());
                });
            }
            // Store permission flags for platform callbacks
            // (separate thread-local so macOS WKUIDelegate / Windows PermissionRequested
            // handlers can read while MANAGER is borrowed)
            let permissions = PermissionFlags {
                allow_camera: opts.allow_camera.unwrap_or(false),
                allow_microphone: opts.allow_microphone.unwrap_or(false),
                allow_file_system: opts.allow_file_system.unwrap_or(false),
            };
            PERMISSIONS_MAP.with(|p| {
                p.borrow_mut().insert(id, permissions);
            });
            mgr.push_command(Command::CreateWindow {
                id,
                options: Box::new(opts),
            });

            // Track window count and determine if we need to start the pump
            mgr.window_count += 1;
            let needs_pump = !crate::pump::is_pump_running();
            Ok((id, needs_pump))
        })?;

        // Start the event pump on first window creation.
        // Must happen outside with_manager() because start_pump needs &Env.
        if needs_pump {
            // Create a JS function that wraps pump_events().
            // When setInterval fires this function, pumpEvents() runs on the
            // main thread — exactly like the old JS `setInterval(pumpEvents, 16)`.
            let pump_fn: Function<'_, (), ()> =
                env.create_function_from_closure("__nw_pump", |ctx| {
                    if let Err(e) = crate::pump_events(*ctx.env) {
                        eprintln!("[native-window] pumpEvents() error: {}", e);
                    }
                    Ok(())
                })?;
            crate::pump::start_pump(&env, pump_fn.into_unknown(&env)?)?;
        }

        Ok(Self { id, closed: false })
    }

    /// Check that the window is still open; returns an error if it has been closed.
    fn ensure_open(&self) -> Result<()> {
        if self.closed {
            return Err(napi::Error::from_reason("Window is closed"));
        }
        Ok(())
    }

    /// Get the unique window ID.
    #[napi(getter)]
    pub fn id(&self) -> u32 {
        self.id
    }

    // ---- Content loading ----

    /// Load a URL in the webview.
    /// Only `http:`, `https:`, and internal `nativewindow:` schemes are allowed.
    #[napi]
    pub fn load_url(&self, url: String) -> Result<()> {
        self.ensure_open()?;
        let trimmed = url.trim().to_string();
        // Allowlist: only permit safe schemes
        if !is_url_scheme_allowed(&trimmed) {
            return Err(napi::Error::from_reason(
                "Blocked: only http:, https:, and nativewindow: URLs are allowed in loadUrl(). \
                 Use evaluateJs() for script execution or loadHtml() for HTML content.",
            ));
        }
        with_manager(|mgr| {
            mgr.push_command(Command::LoadURL {
                id: self.id,
                url: trimmed,
            });
        });
        Ok(())
    }

    /// Load an HTML string directly in the webview.
    #[napi]
    pub fn load_html(&self, html: String) -> Result<()> {
        self.ensure_open()?;
        with_manager(|mgr| {
            mgr.push_command(Command::LoadHTML { id: self.id, html });
        });
        Ok(())
    }

    /// Execute JavaScript code in the webview context.
    /// This is fire-and-forget; use onMessage to receive results.
    #[napi]
    pub fn evaluate_js(&self, script: String) -> Result<()> {
        self.ensure_open()?;
        with_manager(|mgr| {
            mgr.push_command(Command::EvaluateJS {
                id: self.id,
                script,
            });
        });
        Ok(())
    }

    /// Send a message to the webview.
    /// This calls `window.__native_message__(msg)` in the webview context.
    #[napi]
    pub fn post_message(&self, message: String) -> Result<()> {
        self.ensure_open()?;
        // Use json_escape() for safe embedding — handles all control chars,
        // quotes, backslashes, and </script> in a single pass.
        let safe_msg = crate::window_manager::json_escape(&message);
        let script = format!(
            "if(window.__native_message__)window.__native_message__({});",
            safe_msg
        );
        with_manager(|mgr| {
            mgr.push_command(Command::EvaluateJS {
                id: self.id,
                script,
            });
        });
        Ok(())
    }

    // ---- Window control ----

    /// Set the window title.
    #[napi]
    pub fn set_title(&self, title: String) -> Result<()> {
        self.ensure_open()?;
        with_manager(|mgr| {
            mgr.push_command(Command::SetTitle { id: self.id, title });
        });
        Ok(())
    }

    /// Set the window size in logical pixels.
    #[napi]
    pub fn set_size(&self, width: f64, height: f64) -> Result<()> {
        self.ensure_open()?;
        with_manager(|mgr| {
            mgr.push_command(Command::SetSize {
                id: self.id,
                width,
                height,
            });
        });
        Ok(())
    }

    /// Set the minimum window size.
    #[napi]
    pub fn set_min_size(&self, width: f64, height: f64) -> Result<()> {
        self.ensure_open()?;
        with_manager(|mgr| {
            mgr.push_command(Command::SetMinSize {
                id: self.id,
                width,
                height,
            });
        });
        Ok(())
    }

    /// Set the maximum window size.
    #[napi]
    pub fn set_max_size(&self, width: f64, height: f64) -> Result<()> {
        self.ensure_open()?;
        with_manager(|mgr| {
            mgr.push_command(Command::SetMaxSize {
                id: self.id,
                width,
                height,
            });
        });
        Ok(())
    }

    /// Set the window position in screen coordinates.
    #[napi]
    pub fn set_position(&self, x: f64, y: f64) -> Result<()> {
        self.ensure_open()?;
        with_manager(|mgr| {
            mgr.push_command(Command::SetPosition { id: self.id, x, y });
        });
        Ok(())
    }

    /// Set whether the window is resizable.
    #[napi]
    pub fn set_resizable(&self, resizable: bool) -> Result<()> {
        self.ensure_open()?;
        with_manager(|mgr| {
            mgr.push_command(Command::SetResizable {
                id: self.id,
                resizable,
            });
        });
        Ok(())
    }

    /// Set whether the window has decorations (title bar, borders).
    #[napi]
    pub fn set_decorations(&self, decorations: bool) -> Result<()> {
        self.ensure_open()?;
        with_manager(|mgr| {
            mgr.push_command(Command::SetDecorations {
                id: self.id,
                decorations,
            });
        });
        Ok(())
    }

    /// Set whether the window is always on top.
    #[napi]
    pub fn set_always_on_top(&self, always_on_top: bool) -> Result<()> {
        self.ensure_open()?;
        with_manager(|mgr| {
            mgr.push_command(Command::SetAlwaysOnTop {
                id: self.id,
                always_on_top,
            });
        });
        Ok(())
    }

    /// Show the window.
    #[napi]
    pub fn show(&self) -> Result<()> {
        self.ensure_open()?;
        with_manager(|mgr| {
            mgr.push_command(Command::Show { id: self.id });
        });
        Ok(())
    }

    /// Hide the window.
    #[napi]
    pub fn hide(&self) -> Result<()> {
        self.ensure_open()?;
        with_manager(|mgr| {
            mgr.push_command(Command::Hide { id: self.id });
        });
        Ok(())
    }

    /// Close and destroy the window.
    #[napi]
    pub fn close(&mut self) -> Result<()> {
        self.ensure_open()?;
        self.closed = true;
        with_manager(|mgr| {
            mgr.push_command(Command::Close { id: self.id });
        });
        Ok(())
    }

    /// Focus the window.
    #[napi]
    pub fn focus(&self) -> Result<()> {
        self.ensure_open()?;
        with_manager(|mgr| {
            mgr.push_command(Command::Focus { id: self.id });
        });
        Ok(())
    }

    /// Maximize the window.
    #[napi]
    pub fn maximize(&self) -> Result<()> {
        self.ensure_open()?;
        with_manager(|mgr| {
            mgr.push_command(Command::Maximize { id: self.id });
        });
        Ok(())
    }

    /// Minimize the window.
    #[napi]
    pub fn minimize(&self) -> Result<()> {
        self.ensure_open()?;
        with_manager(|mgr| {
            mgr.push_command(Command::Minimize { id: self.id });
        });
        Ok(())
    }

    /// Restore the window from maximized state.
    #[napi]
    pub fn unmaximize(&self) -> Result<()> {
        self.ensure_open()?;
        with_manager(|mgr| {
            mgr.push_command(Command::Unmaximize { id: self.id });
        });
        Ok(())
    }

    /// Reload the current page in the webview.
    #[napi]
    pub fn reload(&self) -> Result<()> {
        self.ensure_open()?;
        with_manager(|mgr| {
            mgr.push_command(Command::Reload { id: self.id });
        });
        Ok(())
    }

    /// Set the window icon from a PNG or ICO file path.
    /// On macOS this is silently ignored.
    #[napi]
    pub fn set_icon(&self, path: String) -> Result<()> {
        self.ensure_open()?;
        with_manager(|mgr| {
            mgr.push_command(Command::SetIcon { id: self.id, path });
        });
        Ok(())
    }

    // ---- Event handlers ----

    /// Register a handler for IPC messages from the webview.
    /// In the webview, call `window.ipc.postMessage(string)` to send messages.
    /// The callback receives the message string and the source page URL.
    #[napi(ts_args_type = "callback: (message: string, sourceUrl: string) => void")]
    pub fn on_message(&self, callback: MessageCallback) -> Result<()> {
        self.ensure_open()?;
        with_manager(|mgr| {
            if let Some(handlers) = mgr.event_handlers.get_mut(&self.id) {
                handlers.on_message = Some(callback);
            }
        });
        Ok(())
    }

    /// Register a handler for the window close event.
    #[napi(ts_args_type = "callback: () => void")]
    pub fn on_close(&self, callback: CloseCallback) -> Result<()> {
        self.ensure_open()?;
        with_manager(|mgr| {
            if let Some(handlers) = mgr.event_handlers.get_mut(&self.id) {
                handlers.on_close = Some(callback);
            }
        });
        Ok(())
    }

    /// Register a handler for window resize events.
    #[napi(ts_args_type = "callback: (width: number, height: number) => void")]
    pub fn on_resize(&self, callback: ResizeCallback) -> Result<()> {
        self.ensure_open()?;
        with_manager(|mgr| {
            if let Some(handlers) = mgr.event_handlers.get_mut(&self.id) {
                handlers.on_resize = Some(callback);
            }
        });
        Ok(())
    }

    /// Register a handler for window move events.
    #[napi(ts_args_type = "callback: (x: number, y: number) => void")]
    pub fn on_move(&self, callback: MoveCallback) -> Result<()> {
        self.ensure_open()?;
        with_manager(|mgr| {
            if let Some(handlers) = mgr.event_handlers.get_mut(&self.id) {
                handlers.on_move = Some(callback);
            }
        });
        Ok(())
    }

    /// Register a handler for window focus events.
    #[napi(ts_args_type = "callback: () => void")]
    pub fn on_focus(&self, callback: FocusCallback) -> Result<()> {
        self.ensure_open()?;
        with_manager(|mgr| {
            if let Some(handlers) = mgr.event_handlers.get_mut(&self.id) {
                handlers.on_focus = Some(callback);
            }
        });
        Ok(())
    }

    /// Register a handler for window blur (lost focus) events.
    #[napi(ts_args_type = "callback: () => void")]
    pub fn on_blur(&self, callback: FocusCallback) -> Result<()> {
        self.ensure_open()?;
        with_manager(|mgr| {
            if let Some(handlers) = mgr.event_handlers.get_mut(&self.id) {
                handlers.on_blur = Some(callback);
            }
        });
        Ok(())
    }

    /// Register a handler for page load events.
    #[napi(ts_args_type = "callback: (event: 'started' | 'finished', url: string) => void")]
    pub fn on_page_load(&self, callback: PageLoadCallback) -> Result<()> {
        self.ensure_open()?;
        with_manager(|mgr| {
            if let Some(handlers) = mgr.event_handlers.get_mut(&self.id) {
                handlers.on_page_load = Some(callback);
            }
        });
        Ok(())
    }

    /// Register a handler for document title change events.
    #[napi(ts_args_type = "callback: (title: string) => void")]
    pub fn on_title_changed(&self, callback: TitleChangedCallback) -> Result<()> {
        self.ensure_open()?;
        with_manager(|mgr| {
            if let Some(handlers) = mgr.event_handlers.get_mut(&self.id) {
                handlers.on_title_changed = Some(callback);
            }
        });
        Ok(())
    }

    /// Register a handler for the window reload event.
    #[napi(ts_args_type = "callback: () => void")]
    pub fn on_reload(&self, callback: ReloadCallback) -> Result<()> {
        self.ensure_open()?;
        with_manager(|mgr| {
            if let Some(handlers) = mgr.event_handlers.get_mut(&self.id) {
                handlers.on_reload = Some(callback);
            }
        });
        Ok(())
    }

    /// Register a handler for blocked navigation events.
    /// Fired when a navigation is blocked by the `allowedHosts` restriction.
    #[napi(ts_args_type = "callback: (url: string) => void")]
    pub fn on_navigation_blocked(&self, callback: NavigationBlockedCallback) -> Result<()> {
        self.ensure_open()?;
        with_manager(|mgr| {
            if let Some(handlers) = mgr.event_handlers.get_mut(&self.id) {
                handlers.on_navigation_blocked = Some(callback);
            }
        });
        Ok(())
    }

    // ---- Devtools ----

    /// Open the browser devtools panel for this window's webview.
    /// Requires `devtools: true` in {@link WindowOptions}.
    #[napi]
    pub fn open_devtools(&self) -> Result<()> {
        self.ensure_open()?;
        with_manager(|mgr| {
            mgr.push_command(Command::OpenDevTools { id: self.id });
        });
        Ok(())
    }

    /// Close the browser devtools panel for this window's webview.
    #[napi]
    pub fn close_devtools(&self) -> Result<()> {
        self.ensure_open()?;
        with_manager(|mgr| {
            mgr.push_command(Command::CloseDevTools { id: self.id });
        });
        Ok(())
    }

    /// Check whether the devtools panel is currently open.
    #[napi]
    pub fn is_devtools_open(&self) -> Result<bool> {
        self.ensure_open()?;
        let open = with_manager(|mgr| {
            mgr.platform
                .as_ref()
                .and_then(|p| p.is_devtools_open(self.id))
                .unwrap_or(false)
        });
        Ok(open)
    }

    // ---- Cookie access ----

    /// Query cookies from the native cookie store.
    ///
    /// Returns validated `CookieInfo` objects synchronously, including
    /// `HttpOnly` cookies that are invisible to `document.cookie`.
    ///
    /// If `url` is provided, only cookies matching that URL are returned.
    /// If omitted, all cookies in the webview's cookie store are returned.
    #[napi]
    pub fn get_cookies(&self, url: Option<String>) -> Result<Vec<CookieInfo>> {
        self.ensure_open()?;
        with_manager(|mgr| {
            if let Some(ref plat) = mgr.platform {
                Ok(plat.get_cookies_sync(self.id, url.as_deref()))
            } else {
                Ok(Vec::new())
            }
        })
    }

    /// Clear cookies from the native cookie store.
    /// If `host` is provided, only cookies whose domain matches that host are deleted.
    /// If omitted, all cookies in the webview's cookie store are cleared.
    #[napi]
    pub fn clear_cookies(&self, host: Option<String>) -> Result<()> {
        self.ensure_open()?;
        with_manager(|mgr| {
            mgr.push_command(Command::ClearCookies { id: self.id, host });
        });
        Ok(())
    }
}

// ── Drop ────────────────────────────────────────────────────────

/// Enqueue a close command when a `NativeWindow` is garbage-collected
/// without an explicit `close()` call, preventing event handler and
/// security config leaks in the thread-local maps.
impl Drop for NativeWindow {
    fn drop(&mut self) {
        if !self.closed {
            with_manager(|mgr| {
                mgr.push_command(Command::Close { id: self.id });
            });
        }
    }
}
