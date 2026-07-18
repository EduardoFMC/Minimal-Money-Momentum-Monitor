use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

// ===== Criptografia opcional com PIN (AES-256-GCM + PBKDF2-SHA256) =====
// Arquivo cifrado: b"M4E1" + salt(16) + nonce(12) + ciphertext.
const ENC_MAGIC: &[u8; 4] = b"M4E1";
const PBKDF2_ITERS: u32 = 600_000;

/// (chave, salt) da sessão desbloqueada; None = sem PIN ou ainda bloqueado
static SESSION: Mutex<Option<([u8; 32], [u8; 16])>> = Mutex::new(None);

fn derive_key(pin: &str, salt: &[u8]) -> [u8; 32] {
    let mut key = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<sha2::Sha256>(pin.as_bytes(), salt, PBKDF2_ITERS, &mut key);
    key
}

fn encrypt_bytes(key: &[u8; 32], salt: &[u8; 16], plaintext: &[u8]) -> Result<Vec<u8>, String> {
    use aes_gcm::aead::{Aead, KeyInit};
    use rand::RngCore;
    let cipher = aes_gcm::Aes256Gcm::new(key.into());
    let mut nonce = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce);
    let ct = cipher
        .encrypt(aes_gcm::Nonce::from_slice(&nonce), plaintext)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(4 + 16 + 12 + ct.len());
    out.extend_from_slice(ENC_MAGIC);
    out.extend_from_slice(salt);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ct);
    Ok(out)
}

fn decrypt_bytes(key: &[u8; 32], bytes: &[u8]) -> Result<String, String> {
    use aes_gcm::aead::{Aead, KeyInit};
    if bytes.len() < 4 + 16 + 12 + 16 {
        return Err("arquivo cifrado curto demais".into());
    }
    let cipher = aes_gcm::Aes256Gcm::new(key.into());
    let nonce = &bytes[20..32];
    let pt = cipher
        .decrypt(aes_gcm::Nonce::from_slice(nonce), &bytes[32..])
        .map_err(|_| "decifragem falhou".to_string())?;
    String::from_utf8(pt).map_err(|e| e.to_string())
}

const ALLOWED_HOSTS: [&str; 4] = [
    "brapi.dev",
    "api.coingecko.com",
    "economia.awesomeapi.com.br",
    "api.bcb.gov.br",
];
const MAX_DAILY_BACKUPS: usize = 14;

/// evita loop ao interceptar o fechamento da janela para gravar antes
static CLOSING: AtomicBool = AtomicBool::new(false);
/// "manter na bandeja ao fechar" (setting do usuário, informado pelo JS)
static TRAY_MODE: AtomicBool = AtomicBool::new(false);

/// log de diagnóstico temporário (%TEMP%\m4-debug.log)
fn dbg_log(msg: &str) {
    use std::io::Write;
    let p = std::env::temp_dir().join("m4-debug.log");
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(p) {
        let _ = writeln!(f, "{:?} {}", std::time::SystemTime::now(), msg);
    }
}

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

/// Lê um candidato (principal ou backup): texto puro validado, ou cifrado
/// decifrável com a chave da sessão.
fn try_read_candidate(path: &PathBuf, session: &Option<([u8; 32], [u8; 16])>) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    if bytes.starts_with(ENC_MAGIC) {
        let (key, _) = session.as_ref()?;
        let s = decrypt_bytes(key, &bytes).ok()?;
        if is_valid_json(&s) { Some(s) } else { None }
    } else {
        let s = String::from_utf8(bytes).ok()?;
        if is_valid_json(&s) { Some(s) } else { None }
    }
}

/// Lê data.json; se estiver ausente, vazio ou corrompido, cai para
/// data.bak.json e depois para o backup diário mais recente. Se o arquivo
/// estiver cifrado e ainda não houver PIN na sessão, sinaliza o bloqueio.
#[tauri::command]
fn load_data(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = data_file(&app)?;
    let session = SESSION.lock().unwrap().clone();

    // cifrado e sem chave: pede o PIN (sem cair em backups antigos em texto
    // puro, o que contornaria a proteção)
    if session.is_none() && path.exists() {
        if let Ok(bytes) = fs::read(&path) {
            if bytes.starts_with(ENC_MAGIC) {
                return Ok(Some("{\"m4Encrypted\":true}".into()));
            }
        }
    }

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
        if let Some(s) = try_read_candidate(cand, &session) {
            if i > 0 {
                // o arquivo principal estava ruim; restaura a partir do backup
                let _ = fs::copy(cand, &path);
            }
            return Ok(Some(s));
        }
    }

    if path.exists() {
        // existe mas nenhum candidato é válido: não mascarar como "primeiro uso"
        return Err("data.json existe mas está ilegível e não há backup válido".into());
    }
    Ok(None)
}

/// Grava payload (texto puro ou cifrado) de forma atômica e durável:
/// .tmp com fsync, data.bak.json + backup diário (14 dias), depois rename.
fn write_data_file(app: &tauri::AppHandle, payload: &[u8]) -> Result<(), String> {
    let path = data_file(app)?;
    let tmp = path.with_extension("json.tmp");
    {
        use std::io::Write;
        let mut f = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(payload).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?; // sobrevive a desligamento
    }
    if path.exists() {
        let _ = fs::copy(&path, path.with_extension("bak.json"));
        let bdir = data_dir(app)?.join("backups");
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

/// Monta o payload conforme a sessão (cifra quando há PIN ativo).
fn build_payload(contents: &str) -> Result<Vec<u8>, String> {
    match SESSION.lock().unwrap().as_ref() {
        Some((key, salt)) => encrypt_bytes(key, salt, contents.as_bytes()),
        None => Ok(contents.as_bytes().to_vec()),
    }
}

#[tauri::command]
fn save_data(app: tauri::AppHandle, contents: String) -> Result<(), String> {
    if !is_valid_json(&contents) {
        return Err("Conteúdo inválido — gravação recusada".into());
    }
    let payload = build_payload(&contents)?;
    write_data_file(&app, &payload)
}

/// Há PIN configurado? (arquivo cifrado no disco ou sessão com chave)
#[tauri::command]
fn is_encrypted(app: tauri::AppHandle) -> Result<bool, String> {
    if SESSION.lock().unwrap().is_some() {
        return Ok(true);
    }
    let path = data_file(&app)?;
    if let Ok(bytes) = fs::read(&path) {
        return Ok(bytes.starts_with(ENC_MAGIC));
    }
    Ok(false)
}

/// Desbloqueia com o PIN: decifra o arquivo e guarda a chave na sessão.
#[tauri::command]
fn unlock(app: tauri::AppHandle, pin: String) -> Result<String, String> {
    let path = data_file(&app)?;
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    if !bytes.starts_with(ENC_MAGIC) {
        return Err("Os dados não estão protegidos por PIN".into());
    }
    if bytes.len() < 4 + 16 + 12 + 16 {
        return Err("Arquivo cifrado corrompido".into());
    }
    let mut salt = [0u8; 16];
    salt.copy_from_slice(&bytes[4..20]);
    let key = derive_key(&pin, &salt);
    let s = decrypt_bytes(&key, &bytes).map_err(|_| "PIN incorreto".to_string())?;
    if !is_valid_json(&s) {
        return Err("PIN incorreto".into());
    }
    *SESSION.lock().unwrap() = Some((key, salt));
    Ok(s)
}

/// Ativa (ou troca) o PIN: nova chave/salt e regrava os dados cifrados.
#[tauri::command]
fn set_pin(app: tauri::AppHandle, pin: String, contents: String) -> Result<(), String> {
    use rand::RngCore;
    if pin.trim().len() < 4 {
        return Err("PIN muito curto (mínimo 4 caracteres)".into());
    }
    if !is_valid_json(&contents) {
        return Err("Conteúdo inválido".into());
    }
    let mut salt = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut salt);
    let key = derive_key(pin.trim(), &salt);
    *SESSION.lock().unwrap() = Some((key, salt));
    let payload = encrypt_bytes(&key, &salt, contents.as_bytes())?;
    write_data_file(&app, &payload)
}

/// Remove o PIN (verificando-o) e regrava os dados em texto puro.
#[tauri::command]
fn clear_pin(app: tauri::AppHandle, pin: String, contents: String) -> Result<(), String> {
    {
        let guard = SESSION.lock().unwrap();
        let (key, salt) = guard.as_ref().ok_or("Nenhum PIN ativo")?;
        if derive_key(pin.trim(), salt) != *key {
            return Err("PIN incorreto".into());
        }
    }
    if !is_valid_json(&contents) {
        return Err("Conteúdo inválido".into());
    }
    *SESSION.lock().unwrap() = None;
    write_data_file(&app, contents.as_bytes())
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
    dbg_log("confirm_close chamado pelo JS");
    CLOSING.store(true, Ordering::SeqCst);
    let _ = window.close();
}

/// JS informa o comportamento do X (setting "manter na bandeja").
#[tauri::command]
fn set_tray_mode(enabled: bool) {
    dbg_log(&format!("set_tray_mode({})", enabled));
    TRAY_MODE.store(enabled, Ordering::SeqCst);
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
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

/// Seleciona um extrato/fatura (OFX ou CSV) e devolve o conteúdo. Arquivos de
/// banco costumam vir em Latin-1/Windows-1252, então lê bytes com tolerância.
#[tauri::command]
async fn import_ofx(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("Extrato ou fatura (OFX, CSV)", &["ofx", "OFX", "csv", "CSV", "txt"])
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

#[cfg(test)]
mod tests {
    use super::*;

    // Ciclo completo do arquivo cifrado, igual ao que set_pin/unlock fazem:
    // gera salt+chave, cifra com cabeçalho M4E1, re-deriva a chave a partir
    // do salt DO ARQUIVO e decifra; PIN errado precisa falhar.
    #[test]
    fn pin_roundtrip_e_pin_errado() {
        use rand::RngCore;
        let contents = r#"{"version":2,"settings":{"brapiToken":"segredo"},"expenses":[]}"#;
        let mut salt = [0u8; 16];
        rand::thread_rng().fill_bytes(&mut salt);
        let key = derive_key("1234", &salt);
        let payload = encrypt_bytes(&key, &salt, contents.as_bytes()).unwrap();

        // formato: magic + salt(16) + nonce(12) + ct(>=16)
        assert!(payload.starts_with(ENC_MAGIC));
        assert!(payload.len() >= 4 + 16 + 12 + 16 + contents.len());
        assert_eq!(&payload[4..20], &salt);
        // não pode haver texto puro visível
        assert!(!payload.windows(7).any(|w| w == b"segredo"));

        // fluxo do unlock: salt lido do arquivo
        let mut salt2 = [0u8; 16];
        salt2.copy_from_slice(&payload[4..20]);
        let key2 = derive_key("1234", &salt2);
        assert_eq!(decrypt_bytes(&key2, &payload).unwrap(), contents);

        // PIN errado falha na autenticação do GCM
        let bad = derive_key("4321", &salt2);
        assert!(decrypt_bytes(&bad, &payload).is_err());
    }

    #[test]
    fn derive_key_deterministica_e_sensivel_ao_salt() {
        let s1 = [1u8; 16];
        let s2 = [2u8; 16];
        assert_eq!(derive_key("abcd", &s1), derive_key("abcd", &s1));
        assert_ne!(derive_key("abcd", &s1), derive_key("abcd", &s2));
        assert_ne!(derive_key("abcd", &s1), derive_key("abce", &s1));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // ícone de bandeja com menu (Abrir / Atualizar / Sair)
            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

            let open = MenuItem::with_id(app, "open", "Abrir M4", true, None::<&str>)?;
            let refresh = MenuItem::with_id(app, "refresh", "Atualizar cotações", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &refresh, &quit])?;

            let mut tray = TrayIconBuilder::with_id("m4-tray")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("Minimal Money Momentum Monitor")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "refresh" => {
                        let _ = app.emit("refresh-request", ());
                    }
                    "quit" => {
                        // mesmo fluxo do fechamento: JS grava pendências e
                        // chama confirm_close; garantia de 1,5s se travar
                        let _ = app.emit("app-close-requested", ());
                        let ah = app.clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(std::time::Duration::from_millis(1500));
                            CLOSING.store(true, Ordering::SeqCst);
                            ah.exit(0);
                        });
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            // tick de 60s vindo do Rust: imune ao throttling do WebView2 com a
            // janela escondida; o JS decide se o intervalo configurado passou
            let ah = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(60));
                let _ = ah.emit("refresh-tick", ());
            });
            Ok(())
        })
        // intercepta o fechamento: em modo bandeja só esconde a janela (o
        // webview continua rodando, salvamentos pendentes completam sozinhos);
        // senão avisa o frontend para gravar e fecha via confirm_close
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                dbg_log(&format!(
                    "CloseRequested: closing={} tray={}",
                    CLOSING.load(Ordering::SeqCst),
                    TRAY_MODE.load(Ordering::SeqCst)
                ));
                if CLOSING.load(Ordering::SeqCst) {
                    return;
                }
                if TRAY_MODE.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.hide();
                    return;
                }
                api.prevent_close();
                let _ = window.emit("app-close-requested", ());
                let w = window.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(1500));
                    dbg_log("fallback: forcando close");
                    CLOSING.store(true, Ordering::SeqCst);
                    let _ = w.close();
                });
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
            confirm_close,
            set_tray_mode,
            is_encrypted,
            unlock,
            set_pin,
            clear_pin
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
