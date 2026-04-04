//! Fuzz target for URL scheme validation — the `is_url_scheme_allowed()` and
//! `is_navigation_scheme_blocked()` functions that form the first line of
//! defense against dangerous URI schemes.
//!
//! A bypass in scheme validation could allow:
//!   - `javascript:` code execution (XSS)
//!   - `file:` local file system access
//!   - `data:` inline content injection
//!   - `blob:` object URL exploitation
//!
//! Validates that:
//!   1. The functions never panic on arbitrary input
//!   2. Dangerous schemes are ALWAYS blocked by `is_navigation_scheme_blocked()`
//!   3. Dangerous schemes are NEVER allowed by `is_url_scheme_allowed()`
//!   4. Only http:, https:, nativewindow: pass `is_url_scheme_allowed()`
//!   5. Scheme checks are case-insensitive (no mixed-case bypass)
//!   6. Leading/trailing whitespace doesn't bypass checks

#![no_main]
use libfuzzer_sys::fuzz_target;

#[path = "../../src/security.rs"]
mod security;
use security::{is_navigation_scheme_blocked, is_url_scheme_allowed};

/// Dangerous schemes that must NEVER be allowed for loadUrl or navigation.
const DANGEROUS_SCHEMES: &[&str] = &["javascript:", "file:", "data:", "blob:"];

fuzz_target!(|data: &str| {
    // ---- Core: never panic ----
    let allowed = is_url_scheme_allowed(data);
    let nav_blocked = is_navigation_scheme_blocked(data);

    let trimmed = data.trim();
    let lower = trimmed.to_lowercase();

    // ---- Invariant 2 & 3: dangerous schemes ----
    for scheme in DANGEROUS_SCHEMES {
        if lower.starts_with(scheme) {
            // loadUrl must reject
            assert!(
                !allowed,
                "is_url_scheme_allowed allowed dangerous scheme {:?} in: {:?}",
                scheme, data
            );
        }
    }

    // Navigation blocking only applies to its specific list
    let nav_lower = data.to_lowercase();
    for scheme in DANGEROUS_SCHEMES {
        if nav_lower.starts_with(scheme) {
            assert!(
                nav_blocked,
                "is_navigation_scheme_blocked missed dangerous scheme {:?} in: {:?}",
                scheme, data
            );
        }
    }

    // ---- Invariant 4: only safe schemes pass is_url_scheme_allowed ----
    if allowed {
        assert!(
            lower.starts_with("http://")
                || lower.starts_with("https://")
                || lower.starts_with("nativewindow:"),
            "is_url_scheme_allowed passed unexpected scheme: {:?}",
            data
        );
    }

    // ---- Invariant 5: case-insensitive bypass attempts ----
    // Generate mixed-case variants of dangerous schemes and verify they're blocked
    let mixed_case_dangerous = [
        "JavaScript:", "JAVASCRIPT:", "jAvAsCrIpT:",
        "File:", "FILE:", "fIlE:",
        "Data:", "DATA:", "dAtA:",
        "Blob:", "BLOB:", "bLoB:",
    ];

    for scheme in mixed_case_dangerous {
        let test_url = format!("{}alert(1)", scheme);
        assert!(
            !is_url_scheme_allowed(&test_url),
            "is_url_scheme_allowed allowed mixed-case dangerous scheme: {:?}",
            test_url
        );
        assert!(
            is_navigation_scheme_blocked(&test_url),
            "is_navigation_scheme_blocked missed mixed-case dangerous scheme: {:?}",
            test_url
        );
    }

    // ---- Invariant 6: whitespace bypass ----
    // is_url_scheme_allowed trims input; verify dangerous schemes with
    // leading/trailing whitespace are still blocked.
    for scheme in DANGEROUS_SCHEMES {
        let padded = format!("  {}payload  ", scheme);
        assert!(
            !is_url_scheme_allowed(&padded),
            "is_url_scheme_allowed allowed whitespace-padded dangerous scheme: {:?}",
            padded
        );
    }
});
