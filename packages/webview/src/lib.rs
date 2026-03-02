use napi_derive::napi;

mod events;
mod options;
mod platform;
mod runtime;
mod window;
mod window_manager;

// Re-export runtime functions so napi picks them up
pub use runtime::*;

use napi::threadsafe_function::ThreadsafeFunctionCallMode;
use window_manager::{
    PENDING_BLURS, PENDING_CLOSES, PENDING_COOKIES, PENDING_FOCUSES, PENDING_MESSAGES,
    PENDING_MOVES, PENDING_NAVIGATION_BLOCKED, PENDING_PAGE_LOADS, PENDING_RELOADS,
    PENDING_RESIZE_CALLBACKS, PENDING_TITLE_CHANGES, is_origin_trusted, with_manager,
};

/// Returns the origin of pages loaded via `loadHtml()`.
///
/// This is the origin string to use in `trustedOrigins` when restricting
/// IPC messages to only accept messages from `loadHtml()` content.
///
/// - macOS/Linux: `"nativewindow://localhost"`
/// - Windows: `"https://nativewindow.localhost"`
#[napi]
pub fn load_html_origin() -> String {
    #[cfg(target_os = "windows")]
    {
        "https://nativewindow.localhost".to_string()
    }
    #[cfg(not(target_os = "windows"))]
    {
        "nativewindow://localhost".to_string()
    }
}

/// Initialize the native window system.
/// Must be called once before creating any windows.
#[napi]
pub fn init() -> napi::Result<()> {
    with_manager(|mgr| {
        if mgr.initialized {
            return Ok(());
        }

        mgr.platform = Some(platform::Platform::new()?);
        mgr.initialized = true;
        Ok(())
    })
}

/// Process pending native UI events and execute queued commands.
/// Call this periodically (e.g., every 16ms via setInterval) to keep
/// the native windows responsive.
///
/// Uses a split-borrow approach: platform + event_handlers are temporarily
/// extracted from MANAGER so that event callbacks fired during command
/// processing and event loop pumping can access MANAGER if needed.
#[napi]
pub fn pump_events() -> napi::Result<()> {
    // Phase 1: drain commands and temporarily extract state
    let (commands, mut platform, mut event_handlers) = with_manager(|mgr| {
        if !mgr.initialized {
            return Err(napi::Error::from_reason(
                "Native window system not initialized. Call init() first.",
            ));
        }
        Ok((
            mgr.drain_commands(),
            mgr.platform.take(),
            std::mem::take(&mut mgr.event_handlers),
        ))
    })?;

    // Phase 2: process commands + pump OS events (MANAGER not borrowed)
    let result = if let Some(ref mut plat) = platform {
        let mut first_err: Option<napi::Error> = None;
        for cmd in commands {
            if let Err(e) = plat.process_command(cmd, &mut event_handlers) {
                eprintln!("[native-window] Command failed: {}", e);
                if first_err.is_none() {
                    first_err = Some(e);
                }
                // Continue processing remaining commands
            }
        }

        plat.pump_events();

        // Destroy native resources for windows that received OS-initiated
        // CloseRequested.  This ensures tao::Window and wry::WebView are
        // properly dropped before the JS on_close callback fires — an
        // abrupt process.exit() in the callback would otherwise leave live
        // native objects whose teardown fails on Windows.
        plat.destroy_pending_closes();

        match first_err {
            Some(e) => Err(e),
            None => Ok(()),
        }
    } else {
        Ok(())
    };

    // Phase 3: put state back and flush deferred callbacks
    with_manager(|mgr| {
        mgr.platform = platform;
        mgr.event_handlers = event_handlers;

        // Snapshot which windows are pending close before flush drains
        // the buffer — we need the IDs for handler cleanup afterward.
        let closed_ids: Vec<u32> = PENDING_CLOSES.with(|p| p.borrow().clone());

        flush_pending_callbacks(&mgr.event_handlers);

        // Clean up event handlers for all closed windows now that
        // callbacks have been dispatched.
        for id in closed_ids {
            mgr.event_handlers.remove(&id);
        }
    });

    result
}

/// Flush all pending callback buffers that were deferred during pump_events.
fn flush_pending_callbacks(
    event_handlers: &std::collections::HashMap<u32, crate::events::WindowEventHandlers>,
) {
    // Flush any IPC messages that were deferred during pump_events
    let pending: Vec<(u32, String, String)> =
        PENDING_MESSAGES.with(|p| std::mem::take(&mut *p.borrow_mut()));
    for (window_id, message, source_url) in pending {
        // Re-check trusted origins for deferred messages
        let trusted = is_origin_trusted(window_id, &source_url);
        if !trusted {
            continue;
        }
        if let Some(handlers) = event_handlers.get(&window_id)
            && let Some(ref cb) = handlers.on_message
        {
            cb.call(
                (message, source_url).into(),
                ThreadsafeFunctionCallMode::NonBlocking,
            );
        }
    }

    // Flush any close events that were deferred during pump_events
    let pending_closes: Vec<u32> = PENDING_CLOSES.with(|p| std::mem::take(&mut *p.borrow_mut()));
    for window_id in pending_closes {
        if let Some(handlers) = event_handlers.get(&window_id)
            && let Some(ref cb) = handlers.on_close
        {
            cb.call((), ThreadsafeFunctionCallMode::NonBlocking);
        }
    }

    // Flush any reload events that were deferred during pump_events (keyboard shortcuts)
    let pending_reloads: Vec<u32> = PENDING_RELOADS.with(|p| std::mem::take(&mut *p.borrow_mut()));
    for window_id in pending_reloads {
        if let Some(handlers) = event_handlers.get(&window_id)
            && let Some(ref cb) = handlers.on_reload
        {
            cb.call((), ThreadsafeFunctionCallMode::NonBlocking);
        }
    }

    // Flush any resize callback events that were deferred during pump_events
    let pending_resize_cbs: Vec<(u32, f64, f64)> =
        PENDING_RESIZE_CALLBACKS.with(|p| std::mem::take(&mut *p.borrow_mut()));
    for (window_id, width, height) in pending_resize_cbs {
        if let Some(handlers) = event_handlers.get(&window_id)
            && let Some(ref cb) = handlers.on_resize
        {
            cb.call(
                (width, height).into(),
                ThreadsafeFunctionCallMode::NonBlocking,
            );
        }
    }

    // Flush any move callback events that were deferred during pump_events
    let pending_moves: Vec<(u32, f64, f64)> =
        PENDING_MOVES.with(|p| std::mem::take(&mut *p.borrow_mut()));
    for (window_id, x, y) in pending_moves {
        if let Some(handlers) = event_handlers.get(&window_id)
            && let Some(ref cb) = handlers.on_move
        {
            cb.call((x, y).into(), ThreadsafeFunctionCallMode::NonBlocking);
        }
    }

    // Flush any focus events that were deferred during pump_events
    let pending_focuses: Vec<u32> = PENDING_FOCUSES.with(|p| std::mem::take(&mut *p.borrow_mut()));
    for window_id in pending_focuses {
        if let Some(handlers) = event_handlers.get(&window_id)
            && let Some(ref cb) = handlers.on_focus
        {
            cb.call((), ThreadsafeFunctionCallMode::NonBlocking);
        }
    }

    // Flush any blur events that were deferred during pump_events
    let pending_blurs: Vec<u32> = PENDING_BLURS.with(|p| std::mem::take(&mut *p.borrow_mut()));
    for window_id in pending_blurs {
        if let Some(handlers) = event_handlers.get(&window_id)
            && let Some(ref cb) = handlers.on_blur
        {
            cb.call((), ThreadsafeFunctionCallMode::NonBlocking);
        }
    }

    // Flush any page load events that were deferred during pump_events
    let pending_page_loads: Vec<(u32, String, String)> =
        PENDING_PAGE_LOADS.with(|p| std::mem::take(&mut *p.borrow_mut()));
    for (window_id, event_type, url) in pending_page_loads {
        if let Some(handlers) = event_handlers.get(&window_id)
            && let Some(ref cb) = handlers.on_page_load
        {
            cb.call(
                (event_type, url).into(),
                ThreadsafeFunctionCallMode::NonBlocking,
            );
        }
    }

    // Flush any navigation-blocked events that were deferred during pump_events
    let pending_nav_blocked: Vec<(u32, String)> =
        PENDING_NAVIGATION_BLOCKED.with(|p| std::mem::take(&mut *p.borrow_mut()));
    for (window_id, url) in pending_nav_blocked {
        if let Some(handlers) = event_handlers.get(&window_id)
            && let Some(ref cb) = handlers.on_navigation_blocked
        {
            cb.call(url, ThreadsafeFunctionCallMode::NonBlocking);
        }
    }

    // Flush any title change events that were deferred during pump_events
    let pending_titles: Vec<(u32, String)> =
        PENDING_TITLE_CHANGES.with(|p| std::mem::take(&mut *p.borrow_mut()));
    for (window_id, title) in pending_titles {
        if let Some(handlers) = event_handlers.get(&window_id)
            && let Some(ref cb) = handlers.on_title_changed
        {
            cb.call(title, ThreadsafeFunctionCallMode::NonBlocking);
        }
    }

    // Flush any cookie query results that were deferred during pump_events
    let pending_cookies: Vec<(u32, String)> =
        PENDING_COOKIES.with(|p| std::mem::take(&mut *p.borrow_mut()));
    for (window_id, json) in pending_cookies {
        if let Some(handlers) = event_handlers.get(&window_id)
            && let Some(ref cb) = handlers.on_cookies
        {
            cb.call(json, ThreadsafeFunctionCallMode::NonBlocking);
        }
    }
}
