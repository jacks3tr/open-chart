use std::{
    collections::HashMap,
    env, fs,
    io::{self, Read, Write},
    net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream},
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use windows_sys::Win32::{
    Security::Cryptography::{BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG},
    System::Threading::CREATE_NO_WINDOW,
};

const LOOPBACK_HOST: &str = "127.0.0.1";
const PREFERRED_PORT: u16 = 4777;
const PORT_ATTEMPTS: u16 = 20;
const MAX_HEADER_BYTES: usize = 32 * 1024;
const MAX_REQUEST_BYTES: usize = 2 * 1024 * 1024;
const MAX_RESPONSE_BYTES: usize = 16 * 1024 * 1024;
const BRIDGE_TIMEOUT: Duration = Duration::from_secs(30);

type PendingResponses = Arc<Mutex<HashMap<String, mpsc::Sender<McpBridgeResponse>>>>;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpHostInfo {
    url: String,
    port: u16,
    discovery_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DiscoveryFile {
    version: u8,
    instance_id: String,
    transport: &'static str,
    url: String,
    authorization: DiscoveryAuthorization,
    pid: u32,
}

#[derive(Serialize)]
struct DiscoveryAuthorization {
    r#type: &'static str,
    token: String,
}

#[derive(Clone, Serialize)]
struct McpBridgeRequest {
    id: String,
    method: &'static str,
    url: String,
    headers: Vec<(String, String)>,
    body: String,
}

#[derive(Deserialize)]
pub struct McpBridgeResponse {
    id: String,
    status: u16,
    headers: Vec<(String, String)>,
    body: String,
}

struct ParsedRequest {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: String,
}

struct HttpFailure {
    status: u16,
    code: &'static str,
}

struct McpHost {
    info: McpHostInfo,
    instance_id: String,
    discovery_path: PathBuf,
    address: SocketAddr,
    stop: Arc<AtomicBool>,
    pending: PendingResponses,
    thread: Option<thread::JoinHandle<()>>,
}

#[derive(Default)]
pub struct McpHostState {
    host: Mutex<Option<McpHost>>,
}

impl McpHostState {
    pub fn shutdown(&self) {
        if let Ok(mut host) = self.host.lock() {
            if let Some(mut active) = host.take() {
                active.shutdown();
            }
        }
    }
}

impl McpHost {
    fn shutdown(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Ok(mut pending) = self.pending.lock() {
            pending.clear();
        }
        let _ = TcpStream::connect_timeout(&self.address, Duration::from_millis(100));
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
        let _ = remove_discovery_file_if_owned(&self.discovery_path, &self.instance_id);
    }
}

impl Drop for McpHost {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn random_hex(bytes: usize) -> Result<String, String> {
    let mut data = vec![0_u8; bytes];
    let status = unsafe {
        BCryptGenRandom(
            std::ptr::null_mut(),
            data.as_mut_ptr(),
            data.len() as u32,
            BCRYPT_USE_SYSTEM_PREFERRED_RNG,
        )
    };
    if status < 0 {
        return Err("Windows could not generate secure random bytes".to_string());
    }
    Ok(data.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn current_windows_identity() -> Result<String, String> {
    let username = env::var("USERNAME")
        .map_err(|_| "USERNAME is required to secure MCP discovery".to_string())?;
    let domain = env::var("USERDOMAIN").unwrap_or_default();
    Ok(if domain.is_empty() {
        username
    } else {
        format!("{domain}\\{username}")
    })
}

fn apply_user_only_acl(path: &Path, directory: bool) -> Result<(), String> {
    let permission = if directory { "(OI)(CI)(F)" } else { "(F)" };
    let grant = format!("{}:{permission}", current_windows_identity()?);
    let status = Command::new("icacls.exe")
        .arg(path)
        .args(["/inheritance:r", "/grant:r", &grant])
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .map_err(|error| format!("Could not secure MCP discovery: {error}"))?;
    if !status.success() {
        return Err("Could not apply the user-only MCP discovery ACL".to_string());
    }
    Ok(())
}

fn write_discovery_file(discovery: &DiscoveryFile) -> Result<PathBuf, String> {
    let local_app_data = env::var_os("LOCALAPPDATA")
        .ok_or_else(|| "LOCALAPPDATA is required for MCP discovery".to_string())?;
    let directory = PathBuf::from(local_app_data).join("OpenChart");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create MCP discovery directory: {error}"))?;
    apply_user_only_acl(&directory, true)?;
    let path = directory.join("mcp.json");
    let contents = serde_json::to_vec_pretty(discovery)
        .map_err(|error| format!("Could not serialize MCP discovery: {error}"))?;
    super::atomic_write(&path, &[contents, b"\n".to_vec()].concat())
        .map_err(|error| format!("Could not write MCP discovery: {error}"))?;
    apply_user_only_acl(&path, false)?;
    Ok(path)
}

fn remove_discovery_file_if_owned(path: &Path, instance_id: &str) -> io::Result<()> {
    let contents = match fs::read(path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    let parsed: serde_json::Value = serde_json::from_slice(&contents)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    if parsed.get("instanceId").and_then(serde_json::Value::as_str) == Some(instance_id) {
        fs::remove_file(path)?;
    }
    Ok(())
}

fn bind_listener() -> Result<(TcpListener, SocketAddr), String> {
    for port in PREFERRED_PORT..PREFERRED_PORT + PORT_ATTEMPTS {
        match TcpListener::bind((Ipv4Addr::LOCALHOST, port)) {
            Ok(listener) => {
                let address = listener
                    .local_addr()
                    .map_err(|error| format!("Could not read MCP listener address: {error}"))?;
                listener
                    .set_nonblocking(true)
                    .map_err(|error| format!("Could not configure MCP listener: {error}"))?;
                return Ok((listener, address));
            }
            Err(error) if error.kind() == io::ErrorKind::AddrInUse => continue,
            Err(error) => return Err(format!("Could not bind MCP loopback listener: {error}")),
        }
    }
    Err(format!(
        "No loopback port was available from {PREFERRED_PORT}"
    ))
}

fn header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

fn valid_header_name(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

fn read_request(stream: &mut TcpStream) -> Result<ParsedRequest, HttpFailure> {
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .map_err(|_| HttpFailure {
            status: 500,
            code: "MCP_REQUEST_FAILED",
        })?;
    let mut buffer = Vec::with_capacity(4096);
    let mut chunk = [0_u8; 8192];
    let end = loop {
        if let Some(end) = header_end(&buffer) {
            break end;
        }
        if buffer.len() >= MAX_HEADER_BYTES {
            return Err(HttpFailure {
                status: 431,
                code: "HEADERS_TOO_LARGE",
            });
        }
        let read = stream.read(&mut chunk).map_err(|_| HttpFailure {
            status: 400,
            code: "INVALID_REQUEST",
        })?;
        if read == 0 {
            return Err(HttpFailure {
                status: 400,
                code: "INVALID_REQUEST",
            });
        }
        buffer.extend_from_slice(&chunk[..read]);
    };

    let headers_text = std::str::from_utf8(&buffer[..end]).map_err(|_| HttpFailure {
        status: 400,
        code: "INVALID_REQUEST",
    })?;
    let mut lines = headers_text.split("\r\n");
    let mut request_line = lines.next().unwrap_or_default().split_whitespace();
    let method = request_line.next().unwrap_or_default().to_string();
    let path = request_line.next().unwrap_or_default().to_string();
    let version = request_line.next().unwrap_or_default();
    if method.is_empty()
        || path.is_empty()
        || version != "HTTP/1.1"
        || request_line.next().is_some()
    {
        return Err(HttpFailure {
            status: 400,
            code: "INVALID_REQUEST",
        });
    }

    let mut headers = HashMap::new();
    for line in lines {
        let (name, value) = line.split_once(':').ok_or(HttpFailure {
            status: 400,
            code: "INVALID_REQUEST",
        })?;
        let name = name.trim().to_ascii_lowercase();
        let value = value.trim().to_string();
        if !valid_header_name(&name)
            || value.contains(['\r', '\n'])
            || headers.insert(name, value).is_some()
        {
            return Err(HttpFailure {
                status: 400,
                code: "INVALID_REQUEST",
            });
        }
    }
    if headers.contains_key("transfer-encoding") {
        return Err(HttpFailure {
            status: 400,
            code: "TRANSFER_ENCODING_REJECTED",
        });
    }
    let content_length = headers
        .get("content-length")
        .ok_or(HttpFailure {
            status: 411,
            code: "CONTENT_LENGTH_REQUIRED",
        })?
        .parse::<usize>()
        .map_err(|_| HttpFailure {
            status: 400,
            code: "INVALID_REQUEST",
        })?;
    if content_length > MAX_REQUEST_BYTES {
        return Err(HttpFailure {
            status: 413,
            code: "REQUEST_TOO_LARGE",
        });
    }
    let body_start = end + 4;
    while buffer.len() < body_start + content_length {
        let read = stream.read(&mut chunk).map_err(|_| HttpFailure {
            status: 400,
            code: "INVALID_REQUEST",
        })?;
        if read == 0 {
            return Err(HttpFailure {
                status: 400,
                code: "INVALID_REQUEST",
            });
        }
        buffer.extend_from_slice(&chunk[..read]);
    }
    let body = String::from_utf8(buffer[body_start..body_start + content_length].to_vec())
        .map_err(|_| HttpFailure {
            status: 400,
            code: "INVALID_UTF8",
        })?;
    Ok(ParsedRequest {
        method,
        path,
        headers,
        body,
    })
}

fn constant_time_eq(left: &str, right: &str) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.bytes()
        .zip(right.bytes())
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

fn valid_host(value: Option<&String>, port: u16) -> bool {
    let expected_ip = format!("{LOOPBACK_HOST}:{port}");
    let expected_name = format!("localhost:{port}");
    value.is_some_and(|value| {
        value.eq_ignore_ascii_case(&expected_ip) || value.eq_ignore_ascii_case(&expected_name)
    })
}

fn valid_origin(value: Option<&String>, port: u16) -> bool {
    let Some(value) = value else {
        return true;
    };
    let normalized = value.to_ascii_lowercase();
    ["http", "https"].iter().any(|scheme| {
        normalized == format!("{scheme}://{LOOPBACK_HOST}:{port}")
            || normalized == format!("{scheme}://localhost:{port}")
    })
}

fn validate_request(request: &ParsedRequest, token: &str, port: u16) -> Result<(), HttpFailure> {
    if !valid_host(request.headers.get("host"), port) {
        return Err(HttpFailure {
            status: 400,
            code: "HOST_REJECTED",
        });
    }
    if !valid_origin(request.headers.get("origin"), port) {
        return Err(HttpFailure {
            status: 403,
            code: "ORIGIN_REJECTED",
        });
    }
    let supplied = request
        .headers
        .get("authorization")
        .and_then(|value| value.strip_prefix("Bearer "));
    if !supplied.is_some_and(|supplied| constant_time_eq(supplied, token)) {
        return Err(HttpFailure {
            status: 401,
            code: "AUTHENTICATION_REQUIRED",
        });
    }
    if request.path != "/mcp" {
        return Err(HttpFailure {
            status: 404,
            code: "NOT_FOUND",
        });
    }
    if request.method != "POST" {
        return Err(HttpFailure {
            status: 405,
            code: "METHOD_NOT_ALLOWED",
        });
    }
    Ok(())
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        411 => "Length Required",
        413 => "Payload Too Large",
        431 => "Request Header Fields Too Large",
        500 => "Internal Server Error",
        503 => "Service Unavailable",
        504 => "Gateway Timeout",
        _ => "Response",
    }
}

fn write_response(
    stream: &mut TcpStream,
    status: u16,
    headers: &[(String, String)],
    body: &[u8],
) -> io::Result<()> {
    stream.set_write_timeout(Some(Duration::from_secs(10)))?;
    write!(stream, "HTTP/1.1 {status} {}\r\n", reason(status))?;
    let mut has_content_type = false;
    for (name, value) in headers {
        let lower = name.to_ascii_lowercase();
        if !valid_header_name(&lower)
            || value.contains(['\r', '\n'])
            || matches!(
                lower.as_str(),
                "content-length" | "transfer-encoding" | "connection"
            )
        {
            continue;
        }
        has_content_type |= lower == "content-type";
        write!(stream, "{lower}: {value}\r\n")?;
    }
    if !has_content_type {
        write!(stream, "content-type: application/json; charset=utf-8\r\n")?;
    }
    write!(
        stream,
        "cache-control: no-store\r\nconnection: close\r\ncontent-length: {}\r\n\r\n",
        body.len()
    )?;
    stream.write_all(body)?;
    stream.flush()
}

fn write_failure(stream: &mut TcpStream, failure: HttpFailure) {
    let body = serde_json::json!({ "ok": false, "code": failure.code }).to_string();
    let mut headers = Vec::new();
    if failure.status == 401 {
        headers.push(("www-authenticate".to_string(), "Bearer".to_string()));
    }
    if failure.status == 405 {
        headers.push(("allow".to_string(), "POST".to_string()));
    }
    let _ = write_response(stream, failure.status, &headers, body.as_bytes());
}

fn wait_for_bridge(
    receiver: &mpsc::Receiver<McpBridgeResponse>,
    stop: &AtomicBool,
) -> Result<McpBridgeResponse, HttpFailure> {
    let deadline = Instant::now() + BRIDGE_TIMEOUT;
    loop {
        if stop.load(Ordering::Acquire) {
            return Err(HttpFailure {
                status: 503,
                code: "MCP_HOST_STOPPING",
            });
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(HttpFailure {
                status: 504,
                code: "MCP_HANDLER_TIMEOUT",
            });
        }
        match receiver.recv_timeout(remaining.min(Duration::from_millis(100))) {
            Ok(response) => return Ok(response),
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err(HttpFailure {
                    status: 503,
                    code: "MCP_HANDLER_UNAVAILABLE",
                });
            }
        }
    }
}

fn handle_connection(
    app: &AppHandle,
    mut stream: TcpStream,
    port: u16,
    token: &str,
    pending: &PendingResponses,
    stop: &AtomicBool,
) {
    if !stream
        .peer_addr()
        .is_ok_and(|address| address.ip().is_loopback())
    {
        write_failure(
            &mut stream,
            HttpFailure {
                status: 403,
                code: "REMOTE_HOST_REJECTED",
            },
        );
        return;
    }
    let request = match read_request(&mut stream) {
        Ok(request) => request,
        Err(failure) => {
            write_failure(&mut stream, failure);
            return;
        }
    };
    if let Err(failure) = validate_request(&request, token, port) {
        write_failure(&mut stream, failure);
        return;
    }
    let id = match random_hex(16) {
        Ok(id) => id,
        Err(_) => {
            write_failure(
                &mut stream,
                HttpFailure {
                    status: 500,
                    code: "MCP_REQUEST_FAILED",
                },
            );
            return;
        }
    };
    let (sender, receiver) = mpsc::channel();
    let inserted = pending
        .lock()
        .map(|mut pending| pending.insert(id.clone(), sender))
        .is_ok();
    if !inserted {
        write_failure(
            &mut stream,
            HttpFailure {
                status: 503,
                code: "MCP_HANDLER_UNAVAILABLE",
            },
        );
        return;
    }
    let headers = request
        .headers
        .into_iter()
        .filter(|(name, _)| !matches!(name.as_str(), "authorization" | "host" | "content-length"))
        .collect();
    let payload = McpBridgeRequest {
        id: id.clone(),
        method: "POST",
        url: format!("http://{LOOPBACK_HOST}:{port}/mcp"),
        headers,
        body: request.body,
    };
    if app.emit("openchart-mcp-request", payload).is_err() {
        if let Ok(mut pending) = pending.lock() {
            pending.remove(&id);
        }
        write_failure(
            &mut stream,
            HttpFailure {
                status: 503,
                code: "MCP_HANDLER_UNAVAILABLE",
            },
        );
        return;
    }
    let response = wait_for_bridge(&receiver, stop);
    if let Ok(mut pending) = pending.lock() {
        pending.remove(&id);
    }
    match response {
        Ok(response) => {
            let body = response.body.as_bytes();
            if !(100..=599).contains(&response.status) || body.len() > MAX_RESPONSE_BYTES {
                write_failure(
                    &mut stream,
                    HttpFailure {
                        status: 500,
                        code: "MCP_RESPONSE_REJECTED",
                    },
                );
                return;
            }
            let _ = write_response(&mut stream, response.status, &response.headers, body);
        }
        Err(failure) => write_failure(&mut stream, failure),
    }
}

fn start_host(app: AppHandle) -> Result<McpHost, String> {
    let (listener, address) = bind_listener()?;
    let port = address.port();
    let token = random_hex(32)?;
    let instance_id = random_hex(16)?;
    let url = format!("http://{LOOPBACK_HOST}:{port}/mcp");
    let discovery = DiscoveryFile {
        version: 1,
        instance_id: instance_id.clone(),
        transport: "streamable-http",
        url: url.clone(),
        authorization: DiscoveryAuthorization {
            r#type: "bearer",
            token: token.clone(),
        },
        pid: std::process::id(),
    };
    let discovery_path = write_discovery_file(&discovery)?;
    let info = McpHostInfo {
        url,
        port,
        discovery_path: discovery_path.to_string_lossy().into_owned(),
    };
    let stop = Arc::new(AtomicBool::new(false));
    let pending = Arc::new(Mutex::new(HashMap::new()));
    let thread_stop = Arc::clone(&stop);
    let thread_pending = Arc::clone(&pending);
    let thread = thread::Builder::new()
        .name("openchart-mcp-loopback".to_string())
        .spawn(move || {
            while !thread_stop.load(Ordering::Acquire) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        handle_connection(&app, stream, port, &token, &thread_pending, &thread_stop)
                    }
                    Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(20));
                    }
                    Err(_) => break,
                }
            }
        })
        .map_err(|error| format!("Could not start MCP listener thread: {error}"))?;
    Ok(McpHost {
        info,
        instance_id,
        discovery_path,
        address,
        stop,
        pending,
        thread: Some(thread),
    })
}

#[tauri::command]
pub fn start_mcp_host(
    app: AppHandle,
    state: State<'_, McpHostState>,
) -> Result<McpHostInfo, String> {
    let mut host = state
        .host
        .lock()
        .map_err(|_| "MCP host state is unavailable".to_string())?;
    if let Some(host) = host.as_ref() {
        return Ok(host.info.clone());
    }
    let started = start_host(app)?;
    let info = started.info.clone();
    *host = Some(started);
    Ok(info)
}

#[tauri::command]
pub fn complete_mcp_request(
    response: McpBridgeResponse,
    state: State<'_, McpHostState>,
) -> Result<(), String> {
    if !(100..=599).contains(&response.status) || response.body.len() > MAX_RESPONSE_BYTES {
        return Err("MCP bridge response is invalid or too large".to_string());
    }
    let host = state
        .host
        .lock()
        .map_err(|_| "MCP host state is unavailable".to_string())?;
    let active = host
        .as_ref()
        .ok_or_else(|| "MCP host is not running".to_string())?;
    let sender = active
        .pending
        .lock()
        .map_err(|_| "MCP pending-request state is unavailable".to_string())?
        .remove(&response.id)
        .ok_or_else(|| "MCP request is no longer pending".to_string())?;
    sender
        .send(response)
        .map_err(|_| "MCP request receiver is no longer available".to_string())
}

#[tauri::command]
pub fn stop_mcp_host(state: State<'_, McpHostState>) -> Result<(), String> {
    state.shutdown();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bearer_host_and_origin_are_all_required() {
        let request = ParsedRequest {
            method: "POST".to_string(),
            path: "/mcp".to_string(),
            headers: HashMap::from([
                ("host".to_string(), "127.0.0.1:4777".to_string()),
                ("origin".to_string(), "http://localhost:4777".to_string()),
                ("authorization".to_string(), "Bearer secret".to_string()),
            ]),
            body: "{}".to_string(),
        };
        assert!(validate_request(&request, "secret", 4777).is_ok());
        assert_eq!(
            validate_request(&request, "different", 4777)
                .expect_err("wrong token must fail")
                .code,
            "AUTHENTICATION_REQUIRED"
        );
    }
}
