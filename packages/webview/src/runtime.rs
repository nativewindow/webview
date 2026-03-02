/// Runtime detection and installation utilities.
///
/// Provides functions to check if the native webview runtime is available
/// and to auto-install it if missing (Windows WebView2 only).

#[cfg(target_os = "windows")]
use windows::core::PWSTR;

#[cfg(target_os = "windows")]
use webview2_com::Microsoft::Web::WebView2::Win32::GetAvailableCoreWebView2BrowserVersionString;

use napi_derive::napi;

/// Information about the native webview runtime.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct RuntimeInfo {
    /// Whether the webview runtime is available.
    pub available: bool,
    /// The version string of the runtime, if available.
    pub version: Option<String>,
    /// The current platform: "macos", "windows", "linux", or "unsupported".
    pub platform: String,
}

/// Check if the native webview runtime is available.
///
/// - **macOS**: Always returns available (WKWebView is a system framework).
/// - **Windows**: Checks for WebView2 using `GetAvailableCoreWebView2BrowserVersionString`.
/// - **Linux**: Always returns available (WebKitGTK is required at build time).
/// - **Other**: Returns unavailable with platform "unsupported".
#[napi]
pub fn check_runtime() -> RuntimeInfo {
    #[cfg(target_os = "macos")]
    {
        RuntimeInfo {
            available: true,
            version: None,
            platform: "macos".to_string(),
        }
    }

    #[cfg(target_os = "windows")]
    {
        check_runtime_windows()
    }

    #[cfg(target_os = "linux")]
    {
        RuntimeInfo {
            available: true,
            version: None,
            platform: "linux".to_string(),
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        RuntimeInfo {
            available: false,
            version: None,
            platform: "unsupported".to_string(),
        }
    }
}

#[cfg(target_os = "windows")]
fn check_runtime_windows() -> RuntimeInfo {
    unsafe {
        let mut version: PWSTR = PWSTR::null();
        let hr = GetAvailableCoreWebView2BrowserVersionString(None, &mut version);

        if hr.is_ok() && !version.is_null() {
            let version_str = version.to_string().unwrap_or_default();
            // Free the allocated string
            windows::Win32::System::Com::CoTaskMemFree(Some(version.0 as *const _));

            if !version_str.is_empty() && version_str != "0.0.0.0" {
                return RuntimeInfo {
                    available: true,
                    version: Some(version_str),
                    platform: "windows".to_string(),
                };
            }
        }

        RuntimeInfo {
            available: false,
            version: None,
            platform: "windows".to_string(),
        }
    }
}

/// The URL for the WebView2 Evergreen Bootstrapper (~2MB).
/// This is Microsoft's stable redirect URL that always points to the latest bootstrapper.
#[cfg(target_os = "windows")]
const BOOTSTRAPPER_URL: &str = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";

/// Ensure the native webview runtime is available, installing it if necessary.
///
/// - **macOS**: Returns immediately (WKWebView is always available).
/// - **Windows**: Checks for WebView2. If not found, downloads the Evergreen
///   Bootstrapper (~2MB) from Microsoft and runs it silently. Returns the
///   runtime info after installation.
/// - **Linux**: Returns immediately (WebKitGTK is required at build time).
/// - **Other**: Returns an error.
///
/// # Security
///
/// On Windows this function **downloads and executes a binary from the
/// internet**. The following mitigations are in place:
///
/// - The download URL is a compile-time constant pointing to Microsoft's
///   stable redirect (`go.microsoft.com/fwlink`).
/// - The temp-directory path is sanitised for PowerShell single-quote
///   injection before interpolation.
/// - A minimum file-size check (≥ 1 KB) rejects truncated or empty
///   downloads.
/// - Authenticode signature verification confirms the binary is validly
///   signed by **Microsoft Corporation**. If verification cannot run
///   (e.g. PowerShell unavailable), the binary is deleted and **not**
///   executed (fail-closed).
/// - The installer file is removed on every exit path.
///
/// **Do not call this function in an elevated (Administrator) context
/// without explicit user consent.** The silent installer will apply
/// system-wide and the caller should ensure the user has agreed to the
/// installation. Prefer calling [`check_runtime`] first to avoid
/// unnecessary network requests when the runtime is already present.
#[napi]
pub fn ensure_runtime() -> napi::Result<RuntimeInfo> {
    #[cfg(target_os = "macos")]
    {
        Ok(RuntimeInfo {
            available: true,
            version: None,
            platform: "macos".to_string(),
        })
    }

    #[cfg(target_os = "windows")]
    {
        ensure_runtime_windows()
    }

    #[cfg(target_os = "linux")]
    {
        Ok(RuntimeInfo {
            available: true,
            version: None,
            platform: "linux".to_string(),
        })
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        Err(napi::Error::from_reason(
            "Unsupported platform. Only macOS, Windows, and Linux are supported.",
        ))
    }
}

#[cfg(target_os = "windows")]
fn ensure_runtime_windows() -> napi::Result<RuntimeInfo> {
    // Check if already available
    let info = check_runtime_windows();
    if info.available {
        return Ok(info);
    }

    // Download the bootstrapper using PowerShell (available on all Windows 10+)
    let temp_dir = std::env::temp_dir();
    let installer_path = temp_dir.join("MicrosoftEdgeWebview2Setup.exe");
    let installer_path_str = installer_path.to_string_lossy().to_string();

    // Download
    let download_result = std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            &format!(
                "Invoke-WebRequest -Uri '{}' -OutFile '{}' -UseBasicParsing",
                BOOTSTRAPPER_URL,
                installer_path_str.replace('\'', "''")
            ),
        ])
        .output();

    match download_result {
        Ok(output) if output.status.success() => {
            // Verify minimum file size to detect truncated/empty downloads
            match std::fs::metadata(&installer_path) {
                Ok(meta) if meta.len() < 1024 => {
                    let _ = std::fs::remove_file(&installer_path);
                    return Err(napi::Error::from_reason(
                        "Downloaded WebView2 bootstrapper is suspiciously small (< 1KB). \
                         The download may have been truncated or intercepted.",
                    ));
                }
                Err(e) => {
                    let _ = std::fs::remove_file(&installer_path);
                    return Err(napi::Error::from_reason(format!(
                        "Cannot read downloaded WebView2 bootstrapper: {}",
                        e
                    )));
                }
                _ => {}
            }
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            // Clean up partial download
            let _ = std::fs::remove_file(&installer_path);
            return Err(napi::Error::from_reason(format!(
                "Failed to download WebView2 bootstrapper: {}",
                stderr.trim()
            )));
        }
        Err(e) => {
            return Err(napi::Error::from_reason(format!(
                "Failed to run PowerShell to download WebView2 bootstrapper: {}",
                e
            )));
        }
    }

    // Verify Authenticode signature before executing.
    // Ensures the downloaded file is signed by Microsoft Corporation.
    // If signature verification fails, the file is deleted and an error is returned.
    let verify_result = std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            &format!(
                "$sig = Get-AuthenticodeSignature -FilePath '{}'; \
                 if ($sig.Status -ne 'Valid') {{ \
                   Write-Error \"Authenticode signature is not valid: $($sig.Status). \
                   StatusMessage: $($sig.StatusMessage)\"; \
                   exit 1 \
                 }} \
                 $signer = $sig.SignerCertificate.Subject; \
                 if ($signer -notlike '*O=Microsoft Corporation*') {{ \
                   Write-Error \"Unexpected signer: $signer\"; \
                   exit 1 \
                 }}",
                installer_path_str.replace('\'', "''")
            ),
        ])
        .output();

    match verify_result {
        Ok(output) if output.status.success() => {
            // Signature valid and signer is Microsoft — proceed
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let _ = std::fs::remove_file(&installer_path);
            return Err(napi::Error::from_reason(format!(
                "WebView2 bootstrapper failed signature verification: {}",
                stderr.trim()
            )));
        }
        Err(e) => {
            // PowerShell not available for verification — refuse to execute
            // an unverified binary to prevent potential supply-chain attacks.
            let _ = std::fs::remove_file(&installer_path);
            return Err(napi::Error::from_reason(format!(
                "Could not verify Authenticode signature of WebView2 bootstrapper: {}. \
                 Refusing to execute unverified binary.",
                e
            )));
        }
    }

    // Run the installer silently
    let install_result = std::process::Command::new(&installer_path)
        .args(["/silent", "/install"])
        .output();

    // Clean up the installer regardless of result
    let _ = std::fs::remove_file(&installer_path);

    match install_result {
        Ok(output) if output.status.success() => {}
        Ok(output) => {
            return Err(napi::Error::from_reason(format!(
                "WebView2 bootstrapper exited with code: {}",
                output.status.code().unwrap_or(-1)
            )));
        }
        Err(e) => {
            return Err(napi::Error::from_reason(format!(
                "Failed to run WebView2 bootstrapper: {}",
                e
            )));
        }
    }

    // Verify installation
    let info = check_runtime_windows();
    if info.available {
        Ok(info)
    } else {
        Err(napi::Error::from_reason(
            "WebView2 installation appeared to succeed but the runtime is still not detected. \
             You may need to restart the application or install manually from: \
             https://developer.microsoft.com/microsoft-edge/webview2/",
        ))
    }
}
