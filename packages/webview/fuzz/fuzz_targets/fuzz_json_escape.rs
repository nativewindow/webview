//! Fuzz target for `json_escape()` — the security-critical function that
//! escapes strings for safe embedding as JSON string values in JavaScript.
//!
//! Validates that the output is always:
//!   1. Wrapped in double quotes
//!   2. Free of unescaped control characters (U+0000–U+001F)
//!   3. Free of unescaped `"`, `\`, or `/` characters
//!   4. Free of bare `</script>` sequences (HTML context injection)
//!   5. Free of unescaped U+2028/U+2029 (JS line terminators)
//!   6. A valid JSON string that round-trips back to the original input

#![no_main]
use libfuzzer_sys::fuzz_target;

#[path = "../../src/security.rs"]
mod security;
use security::json_escape;

fuzz_target!(|data: &str| {
    let escaped = json_escape(data);

    // ---- Invariant 1: output is quoted ----
    assert!(
        escaped.starts_with('"') && escaped.ends_with('"'),
        "Output must be wrapped in double quotes: {:?}",
        escaped
    );

    // Strip the surrounding quotes for content inspection
    let inner = &escaped[1..escaped.len() - 1];

    // ---- Invariant 2: no unescaped control characters ----
    // Walk the inner string; skip characters preceded by a backslash
    let chars: Vec<char> = inner.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '\\' {
            // Skip the escaped character
            i += 2;
            continue;
        }
        let cp = chars[i] as u32;
        assert!(
            cp >= 0x20,
            "Unescaped control character U+{:04X} at position {} in: {:?}",
            cp,
            i,
            escaped
        );
        i += 1;
    }

    // ---- Invariant 3: no unescaped quotes, backslashes, or slashes ----
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '\\' {
            i += 2;
            continue;
        }
        assert!(
            chars[i] != '"',
            "Unescaped double quote in inner content: {:?}",
            escaped
        );
        assert!(
            chars[i] != '\\',
            "Unescaped backslash in inner content: {:?}",
            escaped
        );
        assert!(
            chars[i] != '/',
            "Unescaped forward slash in inner content: {:?}",
            escaped
        );
        i += 1;
    }

    // ---- Invariant 4: no </script> injection ----
    // Even with escaping, verify no case-insensitive </script> appears
    let lower = escaped.to_lowercase();
    assert!(
        !lower.contains("</script>"),
        "Escaped output contains </script>: {:?}",
        escaped
    );

    // ---- Invariant 5: no unescaped U+2028/U+2029 ----
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '\\' {
            i += 2;
            continue;
        }
        assert!(
            chars[i] != '\u{2028}',
            "Unescaped U+2028 LINE SEPARATOR in: {:?}",
            escaped
        );
        assert!(
            chars[i] != '\u{2029}',
            "Unescaped U+2029 PARAGRAPH SEPARATOR in: {:?}",
            escaped
        );
        i += 1;
    }

    // ---- Invariant 6: valid JSON round-trip ----
    // The escaped output should be parseable as a JSON string value.
    // We construct a minimal JSON document and verify it parses.
    // Note: we use a simple manual JSON string parser to avoid
    // pulling in serde_json as a dependency.
    if let Some(decoded) = parse_json_string(&escaped) {
        assert_eq!(
            decoded, data,
            "Round-trip mismatch: input {:?} → escaped {:?} → decoded {:?}",
            data, escaped, decoded
        );
    } else {
        panic!(
            "json_escape produced invalid JSON string: {:?} (input: {:?})",
            escaped, data
        );
    }
});

/// Minimal JSON string parser. Expects input to start and end with `"`.
/// Returns the decoded string content, or `None` if malformed.
fn parse_json_string(s: &str) -> Option<String> {
    let chars: Vec<char> = s.chars().collect();
    if chars.len() < 2 || chars[0] != '"' || chars[chars.len() - 1] != '"' {
        return None;
    }

    let mut out = String::new();
    let mut i = 1; // skip opening quote
    let end = chars.len() - 1; // stop before closing quote

    while i < end {
        if chars[i] == '\\' {
            i += 1;
            if i >= end {
                return None;
            }
            match chars[i] {
                '"' => out.push('"'),
                '\\' => out.push('\\'),
                '/' => out.push('/'),
                'n' => out.push('\n'),
                'r' => out.push('\r'),
                't' => out.push('\t'),
                'b' => out.push('\u{0008}'),
                'f' => out.push('\u{000C}'),
                'u' => {
                    // Parse \uXXXX
                    if i + 4 >= end {
                        return None;
                    }
                    let hex: String = chars[i + 1..i + 5].iter().collect();
                    let cp = u32::from_str_radix(&hex, 16).ok()?;
                    // Handle UTF-16 surrogate pairs
                    if (0xD800..=0xDBFF).contains(&cp) {
                        // High surrogate — expect \uXXXX low surrogate
                        if i + 6 + 4 >= end || chars[i + 5] != '\\' || chars[i + 6] != 'u' {
                            return None;
                        }
                        let hex2: String = chars[i + 7..i + 11].iter().collect();
                        let cp2 = u32::from_str_radix(&hex2, 16).ok()?;
                        if !(0xDC00..=0xDFFF).contains(&cp2) {
                            return None;
                        }
                        let combined = 0x10000 + ((cp - 0xD800) << 10) + (cp2 - 0xDC00);
                        out.push(char::from_u32(combined)?);
                        i += 10;
                    } else {
                        out.push(char::from_u32(cp)?);
                        i += 4;
                    }
                }
                _ => return None, // Unknown escape
            }
        } else {
            out.push(chars[i]);
        }
        i += 1;
    }

    Some(out)
}
