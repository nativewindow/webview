//! Fuzz target for `host_matches_pattern()` and `extract_host()` — the
//! functions that enforce the `allowedHosts` navigation restriction.
//!
//! A bug in host matching could allow navigation to attacker-controlled
//! domains (bypassing restrictions) or block legitimate navigations.
//!
//! Validates that:
//!   1. The functions never panic on arbitrary input
//!   2. Exact patterns are case-insensitive but otherwise strict
//!   3. Wildcard patterns only match intended hosts
//!   4. A host always matches its own exact pattern
//!   5. `extract_host()` returns consistent, lowercased hosts

#![no_main]
use arbitrary::Arbitrary;
use libfuzzer_sys::fuzz_target;

#[path = "../../src/security.rs"]
mod security;
use security::{extract_host, host_matches_pattern};

#[derive(Arbitrary, Debug)]
struct HostMatchInput {
    host: String,
    pattern: String,
}

fuzz_target!(|input: HostMatchInput| {
    let host = &input.host;
    let pattern = &input.pattern;

    // ---- Core: never panic ----
    let result = host_matches_pattern(host, pattern);

    // ---- Invariant 2: exact match is case-insensitive ----
    // If pattern has no wildcard prefix, it should match iff
    // the host equals the pattern (case-insensitive via to_lowercase).
    if !pattern.starts_with('*') {
        let expected = host.to_lowercase() == pattern.to_lowercase();
        assert_eq!(
            result, expected,
            "Exact pattern mismatch: host={:?}, pattern={:?}, got={}, expected={}",
            host, pattern, result, expected
        );
    }

    // ---- Invariant 4: a host always matches its own exact pattern ----
    if !host.is_empty() {
        assert!(
            host_matches_pattern(host, host),
            "Host {:?} should match itself as an exact pattern",
            host
        );
    }

    // ---- Invariant 3: wildcard correctness ----
    if let Some(suffix) = pattern.strip_prefix('*') {
        if let Some(bare) = suffix.strip_prefix('.') {
            // Pattern is "*.example.com"
            // Should match: "sub.example.com", "a.b.example.com", "example.com"
            // Should NOT match: "notexample.com" (unless it ends with ".example.com")

            let host_lower = host.to_lowercase();
            let bare_lower = bare.to_lowercase();
            let suffix_lower = suffix.to_lowercase();

            let should_match =
                host_lower.ends_with(&suffix_lower) || host_lower == bare_lower;
            assert_eq!(
                result, should_match,
                "Wildcard mismatch: host={:?}, pattern={:?}, got={}, expected={}",
                host, pattern, result, should_match
            );
        }
    }

    // ---- extract_host: never panic, consistent output ----
    // Test with various URL-like inputs
    let url_variants = [
        format!("https://{}/path", host),
        format!("http://{}", host),
        host.clone(),
    ];

    for url in &url_variants {
        if let Some(extracted) = extract_host(url) {
            // Extracted host should be lowercased
            assert_eq!(
                extracted,
                extracted.to_lowercase(),
                "extract_host returned non-lowercase host: {:?} from URL: {:?}",
                extracted,
                url
            );
        }
    }
});
