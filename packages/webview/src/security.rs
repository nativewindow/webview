//! Pure security validation functions.
//!
//! This module contains **no** napi, platform, or thread-local dependencies.
//! It can be compiled independently by fuzz targets via `#[path]` inclusion,
//! avoiding the cdylib/ASAN linker conflict entirely.

// ── Origin extraction ──────────────────────────────────────────

/// The custom protocol scheme used by `loadHtml()` content.
const CUSTOM_SCHEME: &str = "nativewindow";

/// Extract the origin (scheme + host + port) from a URL string using the
/// WHATWG URL Standard (`url` crate). Returns `None` for malformed URLs or
/// URLs with opaque origins (e.g. `file:`, `data:`, `blob:`).
///
/// The returned origin string is fully normalized:
///   - Scheme and host are lowercased
///   - Default ports are stripped (80 for http, 443 for https)
///   - Userinfo is stripped
///   - IPv6 addresses are handled correctly
///
/// **Custom scheme handling:** The `url` crate treats all non-special schemes
/// (including our `nativewindow://`) as having opaque origins. We special-case
/// the `nativewindow` scheme and manually construct `scheme://host` so that
/// `trustedOrigins` matching works correctly on macOS/Linux where `loadHtml()`
/// content is served at `nativewindow://localhost/`.
pub fn extract_origin(raw: &str) -> Option<String> {
    let parsed = url::Url::parse(raw).ok()?;
    let origin = parsed.origin();
    let serialized = origin.ascii_serialization();
    if serialized != "null" {
        return Some(serialized);
    }
    // The `url` crate treats custom schemes as having opaque origins.
    // For our own custom protocol, manually construct the origin from
    // the parsed scheme + host so that trustedOrigins matching works
    // correctly on macOS/Linux where loadHtml() content is served at
    // nativewindow://localhost/.
    if parsed.scheme() == CUSTOM_SCHEME
        && let Some(host) = parsed.host_str()
    {
        return Some(format!("{}://{}", parsed.scheme(), host));
    }
    None
}

// ── Host extraction & matching ─────────────────────────────────

/// Extract the host (without port) from a URL string using the `url` crate.
/// Returns `None` for URLs without a host (e.g., `about:blank`, `data:` URIs).
///
/// The returned host is always lowercased for consistent comparison.
/// Note: the `url` crate only lowercases hosts for special schemes
/// (http, https, ftp, etc.) — non-special schemes like `nativewindow://`
/// return opaque hosts verbatim, so we normalize here.
pub fn extract_host(url: &str) -> Option<String> {
    let parsed = url::Url::parse(url).ok()?;
    parsed.host_str().map(|h| h.to_lowercase())
}

/// Check if a host matches a single host pattern (case-insensitive).
///
/// Pattern matching:
///   - Exact: `"example.com"` matches only `example.com`
///   - Wildcard: `"*.example.com"` matches `sub.example.com`,
///     `a.b.example.com`, AND `example.com` itself
pub fn host_matches_pattern(host: &str, pattern: &str) -> bool {
    let host_lower = host.to_lowercase();
    let p = pattern.to_lowercase();
    if let Some(suffix) = p.strip_prefix('*') {
        // "*.example.com" → suffix = ".example.com"
        // Match: host ends with ".example.com"
        //    OR: host equals "example.com" (strip leading dot)
        host_lower.ends_with(suffix)
            || suffix
                .strip_prefix('.')
                .is_some_and(|bare| host_lower == bare)
    } else {
        host_lower == p
    }
}

// ── URL scheme validation ──────────────────────────────────────

/// Check if a URL's scheme is allowed for `loadUrl()`.
///
/// Only `http:`, `https:`, and the internal `nativewindow:` scheme are permitted.
/// All other schemes (including `javascript:`, `file:`, `data:`, `blob:`) are blocked.
pub fn is_url_scheme_allowed(url: &str) -> bool {
    let lower = url.trim().to_lowercase();
    lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("nativewindow:")
}

/// Check if a URL's scheme should be blocked during webview navigation.
///
/// Blocks `javascript:`, `file:`, `data:`, and `blob:` URI schemes which
/// could be used for code injection or local file access.
pub fn is_navigation_scheme_blocked(url: &str) -> bool {
    let lower = url.to_lowercase();
    lower.starts_with("javascript:")
        || lower.starts_with("file:")
        || lower.starts_with("data:")
        || lower.starts_with("blob:")
}

// ── JSON helpers ───────────────────────────────────────────────

/// Escape a string for safe embedding as a JSON string value in JavaScript.
/// The returned string includes surrounding double quotes.
///
/// In addition to the standard JSON escapes, this also escapes:
///   - `/` as `\/` to prevent `</script>` injection in HTML contexts
///   - U+2028 (LINE SEPARATOR) and U+2029 (PARAGRAPH SEPARATOR)
///     which are valid JSON but terminate JS string literals
pub fn json_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '/' => out.push_str("\\/"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{2028}' => out.push_str("\\u2028"),
            '\u{2029}' => out.push_str("\\u2029"),
            c if (c as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

// ── sanitizeForJs ──────────────────────────────────────────────

/// Escape a string for safe embedding inside a JavaScript string literal.
///
/// Handles backslashes, double quotes, newlines, carriage returns, null
/// bytes, closing `</script>` tags, Unicode line/paragraph separators
/// (U+2028, U+2029), backticks, and `${` template expressions.
///
/// Safe for use in double-quoted, single-quoted, and template literal
/// contexts.
pub fn sanitize_for_js(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let chars: Vec<char> = input.chars().collect();
    let len = chars.len();
    let mut i = 0;
    while i < len {
        let c = chars[i];
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{2028}' => out.push_str("\\u2028"),
            '\u{2029}' => out.push_str("\\u2029"),
            '`' => out.push_str("\\`"),
            '$' if i + 1 < len && chars[i + 1] == '{' => {
                out.push_str("\\${");
                i += 1; // skip the '{'
            }
            '<' => {
                // Check for </script> (case-insensitive)
                if i + 8 < len {
                    let rest: String = chars[i..i + 9].iter().collect();
                    if rest.eq_ignore_ascii_case("</script>") {
                        out.push_str("<\\/script>");
                        i += 8; // skip the rest of "</script>"
                    } else {
                        out.push(c);
                    }
                } else {
                    out.push(c);
                }
            }
            c if (c as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
        i += 1;
    }
    out
}
