use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    os::windows::ffi::OsStrExt,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

use tauri::Manager;
use windows_sys::Win32::Storage::FileSystem::{
    MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
};

mod mcp_host;

const MAX_DOCUMENT_BYTES: usize = 32 * 1024 * 1024;
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn document_path(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    let filename = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "The document path has no valid file name".to_string())?;
    if !path.is_absolute() || !filename.to_ascii_lowercase().ends_with(".openchart.json") {
        return Err("OpenChart documents must use an absolute .openchart.json path".to_string());
    }
    Ok(path)
}

fn wide_path(path: &Path) -> Vec<u16> {
    path.as_os_str().encode_wide().chain(Some(0)).collect()
}

fn replace_file(source: &Path, target: &Path) -> io::Result<()> {
    let source = wide_path(source);
    let target = wide_path(target);
    let moved = unsafe {
        MoveFileExW(
            source.as_ptr(),
            target.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if moved == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

fn atomic_write(path: &Path, contents: &[u8]) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "missing parent folder"))?;
    let filename = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "invalid file name"))?;

    for _ in 0..16 {
        let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let temporary = parent.join(format!(
            ".{filename}.{}.{}.tmp",
            std::process::id(),
            sequence
        ));
        let mut file = match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
        {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        };
        let result = (|| {
            file.write_all(contents)?;
            file.sync_all()?;
            drop(file);
            replace_file(&temporary, path)
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        return result;
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "could not allocate a temporary document file",
    ))
}

#[tauri::command]
fn read_document(path: String) -> Result<String, String> {
    let path = document_path(&path)?;
    let metadata =
        fs::metadata(&path).map_err(|error| format!("Document could not be opened: {error}"))?;
    if metadata.len() > MAX_DOCUMENT_BYTES as u64 {
        return Err("The document exceeds the 32 MiB local-file limit".to_string());
    }
    fs::read_to_string(path)
        .map_err(|error| format!("Document could not be read as UTF-8: {error}"))
}

#[tauri::command]
fn write_document(path: String, contents: String) -> Result<(), String> {
    let path = document_path(&path)?;
    if contents.len() > MAX_DOCUMENT_BYTES {
        return Err("The document exceeds the 32 MiB local-file limit".to_string());
    }
    atomic_write(&path, contents.as_bytes())
        .map_err(|error| format!("Document could not be saved atomically: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(mcp_host::McpHostState::default())
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                window.state::<mcp_host::McpHostState>().shutdown();
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_document,
            write_document,
            write_export,
            open_external_link,
            mcp_host::start_mcp_host,
            mcp_host::complete_mcp_request,
            mcp_host::stop_mcp_host
        ])
        .run(tauri::generate_context!())
        .expect("OpenChart desktop host failed");
}

#[tauri::command]
fn open_external_link(url: String) -> Result<(), String> {
    let parsed = tauri::Url::parse(&url).map_err(|_| "Invalid link".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err("Links must use HTTP or HTTPS".to_string());
    }
    use std::os::windows::process::CommandExt;
    std::process::Command::new("rundll32.exe")
        .arg("url.dll,FileProtocolHandler")
        .arg(parsed.as_str())
        .creation_flags(0x08000000)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Link could not be opened: {error}"))
}

#[tauri::command]
fn write_export(path: String, bytes: Vec<u8>) -> Result<(), String> {
    let path = PathBuf::from(path);
    let extension = path.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
    if !path.is_absolute() || !matches!(extension.as_str(), "svg" | "png" | "jpg" | "jpeg" | "pdf" | "pptx" | "d2" | "mmd") {
        return Err("Choose an absolute path with a supported export extension".to_string());
    }
    if bytes.is_empty() || bytes.len() > 64 * 1024 * 1024 {
        return Err("Export must contain data and fit within 64 MiB".to_string());
    }
    atomic_write(&path, &bytes).map_err(|error| format!("Export could not be saved: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_replaces_a_document_without_leaving_a_temporary_file() {
        let directory = std::env::temp_dir().join(format!(
            "openchart-desktop-{}-{}",
            std::process::id(),
            TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&directory).expect("create test directory");
        let document = directory.join("test.openchart.json");
        fs::write(&document, b"before").expect("write original");

        atomic_write(&document, b"after").expect("replace document");

        assert_eq!(fs::read(&document).expect("read document"), b"after");
        assert_eq!(fs::read_dir(&directory).expect("list directory").count(), 1);
        let export = directory.join("diagram.png");
        let bytes = vec![137, 80, 78, 71, 0, 255];
        write_export(export.to_string_lossy().into_owned(), bytes.clone()).expect("save binary export");
        assert_eq!(fs::read(export).expect("read export"), bytes);
        fs::remove_dir_all(directory).expect("remove test directory");
    }
}
