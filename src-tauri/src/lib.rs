use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

const ALLOWED_HOSTS: [&str; 4] = [
    "brapi.dev",
    "api.coingecko.com",
    "economia.awesomeapi.com.br",
    "api.bcb.gov.br",
];
const MAX_DAILY_BACKUPS: usize = 14;

/// evita loop ao interceptar o fechamento da janela para gravar antes
static CLOSING: AtomicBool = AtomicBool::new(false);

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn data_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("data.json"))
}

fn is_valid_json(s: &str) -> bool {
    !s.trim().is_empty() && serde_json::from_str::<serde_json::Value>(s).is_ok()
}

/// Data UTC (AAAA-MM-DD) sem dependência externa — algoritmo civil_from_days.
fn today_stamp() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let z = secs / 86400 + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{:04}-{:02}-{:02}", y, m, d)
}

/// Lê data.json; se estiver ausente, vazio ou corrompido, cai para
/// data.bak.json e depois para o backup diário mais recente.
#[tauri::command]
fn load_data(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = data_file(&app)?;

    let mut candidates: Vec<PathBuf> = vec![path.clone(), path.with_extension("bak.json")];
    let bdir = data_dir(&app)?.join("backups");
    if let Ok(entries) = fs::read_dir(&bdir) {
        let mut backups: Vec<PathBuf> = entries
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.extension().map_or(false, |x| x == "json"))
            .collect();
        backups.sort();
        backups.reverse(); // mais recente primeiro (nome = data)
        candidates.extend(backups);
    }

    for (i, cand) in candidates.iter().enumerate() {
        if !cand.exists() {
            continue;
        }
        match fs::read_to_string(cand) {
            Ok(s) if is_valid_json(&s) => {
                if i > 0 {
                    // o arquivo principal estava ruim; restaura a partir do backup
                    let _ = fs::copy(cand, &path);
                }
                return Ok(Some(s));
            }
            _ => continue,
        }
    }

    if path.exists() {
        // existe mas nenhum candidato é válido: não mascarar como "primeiro uso"
        return Err("data.json existe mas está ilegível e não há backup válido".into());
    }
    Ok(None)
}

/// Grava de forma atômica e durável: escreve num .tmp com fsync, mantém
/// data.bak.json + um backup por dia (14 dias) e só então renomeia.
#[tauri::command]
fn save_data(app: tauri::AppHandle, contents: String) -> Result<(), String> {
    if !is_valid_json(&contents) {
        return Err("Conteúdo inválido — gravação recusada".into());
    }
    let path = data_file(&app)?;
    let tmp = path.with_extension("json.tmp");
    {
        use std::io::Write;
        let mut f = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(contents.as_bytes()).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?; // sobrevive a desligamento
    }
    if path.exists() {
        let _ = fs::copy(&path, path.with_extension("bak.json"));
        let bdir = data_dir(&app)?.join("backups");
        if fs::create_dir_all(&bdir).is_ok() {
            let daily = bdir.join(format!("data-{}.json", today_stamp()));
            if !daily.exists() {
                let _ = fs::copy(&path, &daily);
                prune_backups(&bdir);
            }
        }
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

fn prune_backups(bdir: &PathBuf) {
    if let Ok(entries) = fs::read_dir(bdir) {
        let mut backups: Vec<PathBuf> = entries
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.extension().map_or(false, |x| x == "json"))
            .collect();
        backups.sort(); // nome = data, ordem cronológica
        while backups.len() > MAX_DAILY_BACKUPS {
            let oldest = backups.remove(0);
            let _ = fs::remove_file(oldest);
        }
    }
}

/// Chamado pelo frontend depois de gravar os dados pendentes no fechamento.
#[tauri::command]
fn confirm_close(window: tauri::Window) {
    CLOSING.store(true, Ordering::SeqCst);
    let _ = window.close();
}

#[tauri::command]
fn data_file_path(app: tauri::AppHandle) -> Result<String, String> {
    Ok(data_file(&app)?.to_string_lossy().to_string())
}

#[tauri::command]
async fn http_get(url: String) -> Result<String, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|e| e.to_string())?;
    let host = parsed.host_str().unwrap_or_default().to_string();
    if parsed.scheme() != "https" || !ALLOWED_HOSTS.iter().any(|h| host == *h) {
        return Err(format!("Host não permitido: {host}"));
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .user_agent("M4-Monitor/0.1")
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(parsed).send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        let snippet: String = text.chars().take(300).collect();
        return Err(format!("HTTP {}: {}", status.as_u16(), snippet));
    }
    Ok(text)
}

#[tauri::command]
async fn export_backup(
    app: tauri::AppHandle,
    contents: String,
    suggested_name: String,
) -> Result<Option<String>, String> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_file_name(&suggested_name)
            .add_filter("JSON", &["json"])
            .blocking_save_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    match picked {
        Some(fp) => {
            let path = fp.into_path().map_err(|e| e.to_string())?;
            fs::write(&path, contents.as_bytes()).map_err(|e| e.to_string())?;
            Ok(Some(path.to_string_lossy().to_string()))
        }
        None => Ok(None),
    }
}

/// Seleciona um extrato OFX e devolve o conteúdo. OFX de banco costuma vir
/// em Latin-1/Windows-1252, então lê bytes e converte com tolerância.
#[tauri::command]
async fn import_ofx(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("Extrato OFX", &["ofx", "OFX"])
            .blocking_pick_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    match picked {
        Some(fp) => {
            let path = fp.into_path().map_err(|e| e.to_string())?;
            let bytes = fs::read(&path).map_err(|e| e.to_string())?;
            Ok(Some(String::from_utf8_lossy(&bytes).into_owned()))
        }
        None => Ok(None),
    }
}

#[tauri::command]
async fn import_backup(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("JSON", &["json"])
            .blocking_pick_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    match picked {
        Some(fp) => {
            let path = fp.into_path().map_err(|e| e.to_string())?;
            fs::read_to_string(&path).map(Some).map_err(|e| e.to_string())
        }
        None => Ok(None),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // intercepta o fechamento: avisa o frontend para gravar o que estiver
        // pendente; fecha de verdade no confirm_close (ou após 1,5s de garantia)
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if !CLOSING.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.emit("app-close-requested", ());
                    let w = window.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(1500));
                        CLOSING.store(true, Ordering::SeqCst);
                        let _ = w.close();
                    });
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_data,
            save_data,
            data_file_path,
            http_get,
            export_backup,
            import_backup,
            import_ofx,
            confirm_close
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
