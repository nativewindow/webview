//! Fuzz target for `extract_origin()` — the function that normalizes URL
//! origins for trusted-origin matching in IPC message filtering.
//!
//! This is a security boundary: if `extract_origin()` produces an incorrect
//! origin, IPC messages could be accepted from untrusted pages or blocked
//! from trusted ones.
//!
//! Validates that:
//!   1. The function never panics on arbitrary input
//!   2. If `Some`, the origin is well-formed (scheme://host or scheme://host:port)
//!   3. If `Some`, the origin contains no path, query, or fragment
//!   4. http/https URLs with valid hosts always produce `Some`
//!   5. The custom `nativewindow` scheme is handled correctly
//!   6. The output is fully lowercased (normalized)

#![no_main]
use libfuzzer_sys::fuzz_target;

#[path = "../../src/security.rs"]
mod security;
use security::extract_origin;

fuzz_target!(|data: &str| {
    let result = extract_origin(data);

    if let Some(ref origin) = result {
        // ---- Invariant 2: well-formed origin ----
        // Must contain "://" (scheme separator)
        assert!(
            origin.contains("://"),
            "Origin missing scheme separator: {:?} (input: {:?})",
            origin,
            data
        );

        // ---- Invariant 3: no path, query, or fragment ----
        // After the authority, there should be no path components
        let after_scheme = origin.splitn(2, "://").nth(1).unwrap_or("");
        assert!(
            !after_scheme.contains('/'),
            "Origin contains path separator: {:?} (input: {:?})",
            origin,
            data
        );
        assert!(
            !after_scheme.contains('?'),
            "Origin contains query marker: {:?} (input: {:?})",
            origin,
            data
        );
        assert!(
            !after_scheme.contains('#'),
            "Origin contains fragment marker: {:?} (input: {:?})",
            origin,
            data
        );

        // ---- Invariant 6: fully normalized (lowercased) ----
        assert_eq!(
            *origin,
            origin.to_lowercase(),
            "Origin not fully lowercased: {:?} (input: {:?})",
            origin,
            data
        );
    }

    // ---- Invariant 4: http/https with valid hosts always produce Some ----
    // A well-formed http(s) URL like "http://x.com/path" should always
    // produce an origin. We check this against the raw input since
    // extract_origin() does not trim whitespace.
    let lower = data.to_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        // The url crate should parse these. If parse succeeds with a host,
        // extract_origin should return Some for http/https.
        if let Ok(parsed) = url::Url::parse(data) {
            if parsed.host_str().is_some()
                && (parsed.scheme() == "http" || parsed.scheme() == "https")
            {
                assert!(
                    result.is_some(),
                    "extract_origin returned None for valid http(s) URL: {:?}",
                    data
                );
            }
        }
    }

    // ---- Invariant 5: nativewindow scheme with host produces Some ----
    if lower.starts_with("nativewindow://") {
        if let Ok(parsed) = url::Url::parse(data) {
            if parsed.host_str().is_some() {
                assert!(
                    result.is_some(),
                    "extract_origin returned None for nativewindow:// URL with host: {:?}",
                    data
                );
            }
        }
    }
});
