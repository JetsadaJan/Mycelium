use mycelium_core::ai::{research_topic, AiResearchRequest};
use mycelium_core::vault::VaultEngine;
use serde::Deserialize;
use std::env;
use std::path::PathBuf;
use tiny_http::{Header, Method, Response, Server};

#[derive(Deserialize)]
struct SaveNotePayload {
    rel_path: String,
    raw_markdown: String,
}

#[derive(Deserialize)]
struct RenameNotePayload {
    old_rel_path: String,
    old_title: String,
    new_rel_path: String,
    new_title: String,
    new_raw_markdown: String,
}

#[derive(Deserialize)]
struct DeleteNotePayload {
    rel_path: String,
}

#[derive(Deserialize)]
struct VerifySegmentPayload {
    note_id: String,
    segment_id: String,
    verified_date: String,
}

#[derive(Deserialize)]
struct VerifyNotePayload {
    note_id: String,
    verified_date: String,
}

#[derive(Deserialize)]
struct LinkTermPayload {
    note_id: String,
    term: String,
    target_title: String,
}

#[derive(Deserialize)]
struct SwitchColonyPayload {
    colony_path: String,
}

#[derive(Deserialize)]
struct UploadAssetPayload {
    filename: String,
    base64_data: String,
}

#[derive(Deserialize)]
struct OpenUrlPayload {
    url: String,
}

fn decode_base64(input: &str) -> Result<Vec<u8>, String> {
    let clean: Vec<u8> = input
        .bytes()
        .filter(|b| !b.is_ascii_whitespace())
        .collect();
    let mut out = Vec::with_capacity(clean.len() * 3 / 4);
    let val = |b: u8| -> Result<u8, String> {
        match b {
            b'A'..=b'Z' => Ok(b - b'A'),
            b'a'..=b'z' => Ok(b - b'a' + 26),
            b'0'..=b'9' => Ok(b - b'0' + 52),
            b'+' => Ok(62),
            b'/' => Ok(63),
            b'=' => Ok(0),
            _ => Err("Invalid base64 byte".to_string()),
        }
    };
    for chunk in clean.chunks(4) {
        if chunk.len() < 4 {
            break;
        }
        let n = ((val(chunk[0])? as u32) << 18)
            | ((val(chunk[1])? as u32) << 12)
            | ((val(chunk[2])? as u32) << 6)
            | (val(chunk[3])? as u32);
        out.push(((n >> 16) & 0xFF) as u8);
        if chunk[2] != b'=' {
            out.push(((n >> 8) & 0xFF) as u8);
        }
        if chunk[3] != b'=' {
            out.push((n & 0xFF) as u8);
        }
    }
    Ok(out)
}

fn cors_headers() -> Vec<Header> {
    vec![
        Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap(),
        Header::from_bytes(
            &b"Access-Control-Allow-Methods"[..],
            &b"GET, POST, OPTIONS"[..],
        )
        .unwrap(),
        Header::from_bytes(&b"Access-Control-Allow-Headers"[..], &b"Content-Type"[..]).unwrap(),
        Header::from_bytes(
            &b"Content-Type"[..],
            &b"application/json; charset=utf-8"[..],
        )
        .unwrap(),
    ]
}

fn json_response(status: u16, body: String) -> Response<std::io::Cursor<Vec<u8>>> {
    let mut resp = Response::from_string(body).with_status_code(status);
    for h in cors_headers() {
        resp.add_header(h);
    }
    resp
}

fn decode_query_param(raw: &str) -> String {
    let mut out = Vec::new();
    let bytes = raw.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(hex_str) = std::str::from_utf8(&bytes[i + 1..i + 3]) {
                if let Ok(val) = u8::from_str_radix(hex_str, 16) {
                    out.push(val);
                    i += 3;
                    continue;
                }
            }
        } else if bytes[i] == b'+' {
            out.push(b' ');
            i += 1;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn mime_for_path(path: &std::path::Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase()
        .as_str()
    {
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "m4a" => "audio/mp4",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

pub fn run(args: Vec<String>) {
    let default_vault = env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("sample-vault");

    let vault_path = args
        .iter()
        .skip(1)
        .find(|a| !a.starts_with("--"))
        .map(PathBuf::from)
        .unwrap_or(default_vault);

    let mut engine = VaultEngine::new(&vault_path);
    if let Err(err) = engine.scan_vault() {
        eprintln!("Warning scanning vault at {:?}: {}", vault_path, err);
    }

    if args.iter().any(|a| a == "--scan-only") {
        println!("Vault indexed successfully at {:?}", vault_path);
        return;
    }

    let addr = "127.0.0.1:4174";
    let server = Server::http(addr).expect("Failed to start Mycelium Rust API server");
    println!(
        "Mycelium Rust Core running on http://{} (Vault: {:?})",
        addr, vault_path
    );

    for mut request in server.incoming_requests() {
        if *request.method() == Method::Options {
            let _ = request.respond(json_response(200, "{}".to_string()));
            continue;
        }

        let url = request.url().to_string();
        if *request.method() == Method::Get && url.starts_with("/api/fs/dirs") {
            let query = url.trim_start_matches("/api/fs/dirs").trim_start_matches('?');
            let mut requested_path = String::new();
            for pair in query.split('&') {
                if let Some(val) = pair.strip_prefix("path=") {
                    requested_path = decode_query_param(val);
                }
            }
            let base_dir = if requested_path.trim().is_empty() {
                engine
                    .root
                    .parent()
                    .map(|p| p.to_path_buf())
                    .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
            } else {
                PathBuf::from(requested_path.trim())
            };

            let target_dir = if base_dir.is_dir() {
                base_dir
            } else {
                env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
            };

            let parent_path = target_dir
                .parent()
                .map(|p| p.to_string_lossy().to_string());

            let mut subdirs = Vec::new();
            let mut md_in_current = 0usize;
            if let Ok(entries) = std::fs::read_dir(&target_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name.starts_with('.') || name == "node_modules" || name == "target" {
                        continue;
                    }
                    if path.is_dir() {
                        let md_count = std::fs::read_dir(&path)
                            .map(|rd| {
                                rd.flatten()
                                    .filter(|f| {
                                        f.path()
                                            .extension()
                                            .and_then(|e| e.to_str())
                                            .map(|e| e.eq_ignore_ascii_case("md"))
                                            .unwrap_or(false)
                                    })
                                    .count()
                            })
                            .unwrap_or(0);
                        subdirs.push(serde_json::json!({
                            "name": name,
                            "path": path.to_string_lossy().to_string(),
                            "md_count": md_count
                        }));
                    } else if path
                        .extension()
                        .and_then(|e| e.to_str())
                        .map(|e| e.eq_ignore_ascii_case("md"))
                        .unwrap_or(false)
                    {
                        md_in_current += 1;
                    }
                }
            }
            subdirs.sort_by(|a, b| {
                a["name"]
                    .as_str()
                    .unwrap_or("")
                    .to_lowercase()
                    .cmp(&b["name"].as_str().unwrap_or("").to_lowercase())
            });

            let payload = serde_json::json!({
                "current_path": target_dir.to_string_lossy().to_string(),
                "parent_path": parent_path,
                "md_count": md_in_current,
                "directories": subdirs
            })
            .to_string();
            let _ = request.respond(json_response(200, payload));
            continue;
        }

        if *request.method() == Method::Post && url == "/api/fs/pick-folder" {
            #[cfg(target_os = "macos")]
            let picked_path = {
                let script = r#"tell application "System Events" to activate
POSIX path of (choose folder with prompt "Select Colony Directory:")"#;
                match std::process::Command::new("osascript")
                    .arg("-e")
                    .arg(script)
                    .output()
                {
                    Ok(output) if output.status.success() => {
                        let path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
                        if path_str.is_empty() {
                            None
                        } else {
                            Some(path_str.trim_end_matches('/').to_string())
                        }
                    }
                    _ => None,
                }
            };

            #[cfg(not(target_os = "macos"))]
            let picked_path: Option<String> = None;

            if let Some(path) = picked_path {
                let name = std::path::Path::new(&path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("Colony")
                    .to_string();
                let res = serde_json::json!({
                    "path": path,
                    "name": name,
                    "cancelled": false
                })
                .to_string();
                let _ = request.respond(json_response(200, res));
            } else {
                let res = serde_json::json!({
                    "cancelled": true
                })
                .to_string();
                let _ = request.respond(json_response(200, res));
            }
            continue;
        }

        if *request.method() == Method::Get && url.starts_with("/api/asset?") {
            let query = url.trim_start_matches("/api/asset?");
            let mut target_rel = String::new();
            for pair in query.split('&') {
                if let Some(val) = pair.strip_prefix("path=") {
                    target_rel = decode_query_param(val);
                }
            }
            if let Some(file_path) = engine.resolve_asset_path(&target_rel) {
                if let Ok(bytes) = std::fs::read(&file_path) {
                    let mime = mime_for_path(&file_path);
                    let mut resp = Response::from_data(bytes).with_status_code(200);
                    resp.add_header(
                        Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap(),
                    );
                    resp.add_header(
                        Header::from_bytes(&b"Content-Type"[..], mime.as_bytes()).unwrap(),
                    );
                    let _ = request.respond(resp);
                    continue;
                }
            }
            let _ = request.respond(json_response(404, "{\"error\":\"Asset not found\"}".to_string()));
            continue;
        }

        let mut body_str = String::new();
        let _ = request.as_reader().read_to_string(&mut body_str);

        let result: Result<String, String> = match (request.method(), url.as_str()) {
            (&Method::Get, "/api/vault") => engine
                .scan_vault()
                .and_then(|s| serde_json::to_string(&s).map_err(|e| e.to_string())),
            (&Method::Post, "/api/colony/switch") => {
                serde_json::from_str::<SwitchColonyPayload>(&body_str)
                    .map_err(|e| e.to_string())
                    .and_then(|p| {
                        let new_path = PathBuf::from(&p.colony_path);
                        std::fs::create_dir_all(&new_path).map_err(|e| e.to_string())?;
                        engine = VaultEngine::new(&new_path);
                        engine.scan_vault()
                    })
                    .and_then(|s| serde_json::to_string(&s).map_err(|e| e.to_string()))
            }
            (&Method::Post, "/api/note/save") => serde_json::from_str::<SaveNotePayload>(&body_str)
                .map_err(|e| e.to_string())
                .and_then(|p| engine.save_note(&p.rel_path, &p.raw_markdown))
                .and_then(|s| serde_json::to_string(&s).map_err(|e| e.to_string())),
            (&Method::Post, "/api/note/rename") => {
                serde_json::from_str::<RenameNotePayload>(&body_str)
                    .map_err(|e| e.to_string())
                    .and_then(|p| {
                        engine.rename_note_and_refactor(
                            &p.old_rel_path,
                            &p.old_title,
                            &p.new_rel_path,
                            &p.new_title,
                            &p.new_raw_markdown,
                        )
                    })
                    .and_then(|s| serde_json::to_string(&s).map_err(|e| e.to_string()))
            }
            (&Method::Post, "/api/note/delete") => {
                serde_json::from_str::<DeleteNotePayload>(&body_str)
                    .map_err(|e| e.to_string())
                    .and_then(|p| engine.delete_note(&p.rel_path))
                    .and_then(|s| serde_json::to_string(&s).map_err(|e| e.to_string()))
            }
            (&Method::Post, "/api/note/verify-segment") => {
                serde_json::from_str::<VerifySegmentPayload>(&body_str)
                    .map_err(|e| e.to_string())
                    .and_then(|p| {
                        engine.verify_segment(&p.note_id, &p.segment_id, &p.verified_date)
                    })
                    .and_then(|s| serde_json::to_string(&s).map_err(|e| e.to_string()))
            }
            (&Method::Post, "/api/note/verify-all") => {
                serde_json::from_str::<VerifyNotePayload>(&body_str)
                    .map_err(|e| e.to_string())
                    .and_then(|p| engine.verify_entire_note(&p.note_id, &p.verified_date))
                    .and_then(|s| serde_json::to_string(&s).map_err(|e| e.to_string()))
            }
            (&Method::Post, "/api/note/link-term") => {
                serde_json::from_str::<LinkTermPayload>(&body_str)
                    .map_err(|e| e.to_string())
                    .and_then(|p| engine.link_term(&p.note_id, &p.term, &p.target_title))
                    .and_then(|s| serde_json::to_string(&s).map_err(|e| e.to_string()))
            }
            (&Method::Post, "/api/ai/research") => {
                serde_json::from_str::<AiResearchRequest>(&body_str)
                    .map_err(|e| e.to_string())
                    .and_then(|req| research_topic(&req))
                    .and_then(|res| serde_json::to_string(&res).map_err(|e| e.to_string()))
            }
            (&Method::Post, "/api/asset/upload") => {
                serde_json::from_str::<UploadAssetPayload>(&body_str)
                    .map_err(|e| e.to_string())
                    .and_then(|p| {
                        let safe_name = std::path::Path::new(&p.filename)
                            .file_name()
                            .and_then(|s| s.to_str())
                            .unwrap_or("uploaded-media.png")
                            .to_string();
                        let assets_dir = engine.root.join("assets");
                        std::fs::create_dir_all(&assets_dir).map_err(|e| e.to_string())?;
                        let bytes = decode_base64(&p.base64_data)?;
                        let dest = assets_dir.join(&safe_name);
                        std::fs::write(&dest, bytes).map_err(|e| e.to_string())?;
                        Ok(serde_json::json!({
                            "rel_path": format!("assets/{}", safe_name),
                            "filename": safe_name
                        })
                        .to_string())
                    })
            }
            (&Method::Post, "/api/open-url") => {
                serde_json::from_str::<OpenUrlPayload>(&body_str)
                    .map_err(|e| e.to_string())
                    .and_then(|p| {
                        let trimmed = p.url.trim();
                        if !(trimmed.starts_with("http://")
                            || trimmed.starts_with("https://")
                            || trimmed.starts_with("mailto:"))
                        {
                            return Err("Unsupported URL scheme".to_string());
                        }
                        #[cfg(target_os = "macos")]
                        let status = std::process::Command::new("open")
                            .arg(trimmed)
                            .spawn();
                        #[cfg(target_os = "linux")]
                        let status = std::process::Command::new("xdg-open")
                            .arg(trimmed)
                            .spawn();
                        #[cfg(target_os = "windows")]
                        let status = std::process::Command::new("cmd")
                            .args(["/C", "start", "", trimmed])
                            .spawn();
                        status.map_err(|e| e.to_string())?;
                        Ok("{\"ok\":true}".to_string())
                    })
            }
            _ => Err(format!("Route not found: {}", url)),
        };

        match result {
            Ok(json) => {
                let _ = request.respond(json_response(200, json));
            }
            Err(err) => {
                let err_json = serde_json::json!({ "error": err }).to_string();
                let _ = request.respond(json_response(400, err_json));
            }
        }
    }
}
