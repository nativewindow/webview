//! Native event pump management — replaces the JS-side setInterval logic.
//!
//! The pump is started by the Rust `NativeWindow` constructor when the first
//! window is created, and stopped when the last window closes.  The actual
//! timing uses the JS `setInterval` / `clearInterval` APIs, invoked from
//! Rust via `napi_run_script`.  This keeps the pump on the main thread
//! (required for macOS AppKit) while moving all lifecycle management into
//! the native layer.
//!
//! The pump function is stored on `globalThis.__nw_pump` so that the
//! script can reference it.  `setInterval` holds its own reference to the
//! function, so we delete the `globalThis` property immediately after
//! creating the interval.
//!
//! Why `napi_run_script` instead of napi-rs's typed `Function::apply`?
//! Bun's `setInterval` is a host function that validates its first argument
//! using an internal type check.  When the pump function is passed through
//! napi-rs's `FnArgs` tuple conversion → `napi_call_function`, the value
//! fails Bun's stricter "is this a function?" check.  Using
//! `napi_run_script` executes the JS natively, sidestepping this entirely.

use std::cell::RefCell;

use napi::bindgen_prelude::*;

// Thread-local storage for the pump interval ID.
// Stored outside MANAGER because we need `Env` access to start/stop,
// and Env is not Send.
thread_local! {
    static PUMP_INTERVAL_ID: RefCell<Option<f64>> = const { RefCell::new(None) };
}

/// Run a JS script via `napi_run_script` and return the raw `napi_value`.
///
/// This bypasses napi-rs's typed wrappers entirely, using the N-API C
/// interface directly.  The script is evaluated in the global scope.
///
/// Returns `Err` if the string creation or script execution fails.
fn run_script_raw(env: &Env, script: &str) -> napi::Result<napi::sys::napi_value> {
    let mut script_val = std::ptr::null_mut();
    let status = unsafe {
        napi::sys::napi_create_string_utf8(
            env.raw(),
            script.as_ptr().cast(),
            script.len() as isize,
            &mut script_val,
        )
    };
    if status != napi::sys::Status::napi_ok {
        return Err(napi::Error::from_reason(
            "Failed to create script string for napi_run_script",
        ));
    }

    let mut result = std::ptr::null_mut();
    let status = unsafe { napi::sys::napi_run_script(env.raw(), script_val, &mut result) };
    if status != napi::sys::Status::napi_ok {
        return Err(napi::Error::from_reason(
            "napi_run_script failed — check script syntax",
        ));
    }

    Ok(result)
}

/// Extract a `f64` from a raw `napi_value` by coercing to number first.
fn get_double_raw(env: &Env, value: napi::sys::napi_value) -> napi::Result<f64> {
    let mut coerced = std::ptr::null_mut();
    unsafe {
        napi::sys::napi_coerce_to_number(env.raw(), value, &mut coerced);
    }
    let mut out = 0.0;
    unsafe {
        napi::sys::napi_get_value_double(env.raw(), coerced, &mut out);
    }
    Ok(out)
}

/// Start the event pump by creating a `setInterval` that calls `pumpEvents()`.
///
/// `pump_fn` is a JS `Function` (as `Unknown`) that calls `pumpEvents()` when invoked.
/// It is created by the caller (NativeWindow constructor) via
/// `env.create_function_from_closure`.
///
/// Uses `napi_run_script` to invoke `setInterval` from JS rather than going
/// through napi-rs's typed `Function::apply`, which mis-converts the function
/// argument in Bun.
pub fn start_pump(env: &Env, pump_fn: Unknown<'_>) -> napi::Result<()> {
    // Store the pump function on globalThis so the script can reference it.
    // setInterval holds its own reference to the function; we delete the
    // globalThis property immediately afterward to avoid polluting the global.
    let mut global = env.get_global()?;
    global.set_named_property("__nw_pump", pump_fn)?;

    // Call setInterval via napi_run_script — avoids napi typed function call
    // issues with Bun's host functions.
    let result = run_script_raw(
        env,
        "(function(){var id=setInterval(globalThis.__nw_pump,16);\
         delete globalThis.__nw_pump;return id})()",
    )?;
    let interval_id = get_double_raw(env, result)?;

    PUMP_INTERVAL_ID.with(|id| {
        *id.borrow_mut() = Some(interval_id);
    });

    Ok(())
}

/// Stop the event pump by calling `clearInterval`.
///
/// Uses `napi_run_script` for consistency with `start_pump`.
pub fn stop_pump(env: &Env) -> napi::Result<()> {
    let interval_id = PUMP_INTERVAL_ID.with(|id| id.borrow_mut().take());

    if let Some(id) = interval_id {
        // Inline the interval ID into a clearInterval() script.
        let script = format!("clearInterval({})", id);
        let _ = run_script_raw(env, &script);
    }

    Ok(())
}

/// Returns `true` if the pump is currently running.
pub fn is_pump_running() -> bool {
    PUMP_INTERVAL_ID.with(|id| id.borrow().is_some())
}
