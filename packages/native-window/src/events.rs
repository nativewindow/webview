use napi::bindgen_prelude::{FnArgs, Status};
use napi::threadsafe_function::ThreadsafeFunction;

// NOTE (V-25): All callbacks use CalleeHandled=false (equivalent to the old
// ErrorStrategy::Fatal) — if a JavaScript callback throws an uncaught
// exception, the entire process will abort. This is a deliberate fail-fast
// design choice. Users should wrap their callback bodies in try/catch to
// prevent unhandled exceptions from crashing the application.

/// Helper alias: a ThreadsafeFunction with no error handling on the JS side
/// (CalleeHandled=false). Equivalent to the old ErrorStrategy::Fatal.
type FatalTsfn<T> = ThreadsafeFunction<T, (), T, Status, false>;

/// Callback for string messages from the webview IPC: (message, source_url).
pub type MessageCallback = FatalTsfn<FnArgs<(String, String)>>;

/// Callback for window close events.
pub type CloseCallback = FatalTsfn<()>;

/// Callback for resize events: (width, height).
pub type ResizeCallback = FatalTsfn<FnArgs<(f64, f64)>>;

/// Callback for move events: (x, y).
pub type MoveCallback = FatalTsfn<FnArgs<(f64, f64)>>;

/// Callback for focus/blur events (no payload).
pub type FocusCallback = FatalTsfn<()>;

/// Callback for page load events: (event_type, url)
/// event_type is "started" or "finished"
pub type PageLoadCallback = FatalTsfn<FnArgs<(String, String)>>;

/// Callback for document title change events.
pub type TitleChangedCallback = FatalTsfn<String>;

/// Callback for reload events (no payload).
pub type ReloadCallback = FatalTsfn<()>;

/// Callback for cookie query results (JSON payload string).
/// The payload is a JSON array of cookie objects.
pub type CookiesCallback = FatalTsfn<String>;

/// Callback for blocked navigation events: (url).
pub type NavigationBlockedCallback = FatalTsfn<String>;

/// Stored event handlers for a window.
pub struct WindowEventHandlers {
    pub on_message: Option<MessageCallback>,
    pub on_close: Option<CloseCallback>,
    pub on_resize: Option<ResizeCallback>,
    pub on_move: Option<MoveCallback>,
    pub on_focus: Option<FocusCallback>,
    pub on_blur: Option<FocusCallback>,
    pub on_page_load: Option<PageLoadCallback>,
    pub on_title_changed: Option<TitleChangedCallback>,
    pub on_reload: Option<ReloadCallback>,
    pub on_cookies: Option<CookiesCallback>,
    pub on_navigation_blocked: Option<NavigationBlockedCallback>,
}

impl WindowEventHandlers {
    pub fn new() -> Self {
        Self {
            on_message: None,
            on_close: None,
            on_resize: None,
            on_move: None,
            on_focus: None,
            on_blur: None,
            on_page_load: None,
            on_title_changed: None,
            on_reload: None,
            on_cookies: None,
            on_navigation_blocked: None,
        }
    }
}
