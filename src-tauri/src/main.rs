#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod server;

use std::path::Path;
use std::{env, fs};
use tauri::Manager;

fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let target = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_all(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

fn main() {
    let args: Vec<String> = env::args().collect();

    // Headless mode: `mycelium --server [vault_path]` or `--scan-only` (dev / CI use).
    if args.iter().any(|a| a == "--server" || a == "--scan-only") {
        server::run(args);
        return;
    }

    tauri::Builder::default()
        .setup(|app| {
            let colony = app.path().document_dir()?.join("Mycelium Colony");
            if !colony.exists() {
                if let Ok(resources) = app.path().resource_dir() {
                    let seed = resources.join("sample-vault");
                    if seed.is_dir() {
                        let _ = copy_dir_all(&seed, &colony);
                    }
                }
                let _ = fs::create_dir_all(&colony);
            }
            let server_args = vec![
                "mycelium".to_string(),
                colony.to_string_lossy().to_string(),
            ];
            std::thread::spawn(move || server::run(server_args));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Mycelium");
}
