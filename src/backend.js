// Ponte com o backend Tauri. Fora do Tauri (ex.: navegador durante o
// desenvolvimento) usa localStorage e fetch direto como fallback.
import { invoke } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

export const isTauri = typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;

const LS_KEY = "m4-data";

export async function loadData() {
  if (isTauri) {
    const s = await invoke("load_data");
    return s ? JSON.parse(s) : null;
  }
  const s = localStorage.getItem(LS_KEY);
  return s ? JSON.parse(s) : null;
}

export async function saveData(data) {
  const s = JSON.stringify(data);
  if (isTauri) await invoke("save_data", { contents: s });
  else localStorage.setItem(LS_KEY, s);
}

export async function httpGet(url) {
  if (isTauri) return await invoke("http_get", { url });
  const r = await fetch(url);
  if (!r.ok) throw new Error("HTTP " + r.status);
  return await r.text();
}

export async function exportBackup(data) {
  const s = JSON.stringify(data, null, 2);
  const name = `m4-backup-${new Date().toISOString().slice(0, 10)}.json`;
  if (isTauri) return await invoke("export_backup", { contents: s, suggestedName: name });
  const blob = new Blob([s], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
  return name;
}

export async function importBackup() {
  if (isTauri) {
    const s = await invoke("import_backup");
    return s ? JSON.parse(s) : null;
  }
  return new Promise((resolve, reject) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".json,application/json";
    inp.onchange = () => {
      const f = inp.files[0];
      if (!f) return resolve(null);
      const rd = new FileReader();
      rd.onload = () => {
        try { resolve(JSON.parse(rd.result)); } catch (e) { reject(e); }
      };
      rd.readAsText(f);
    };
    inp.click();
  });
}

export async function dataFilePath() {
  if (isTauri) return await invoke("data_file_path");
  return "localStorage do navegador (modo de desenvolvimento)";
}

// ===== Proteção com PIN (arquivo cifrado no disco) =====
export async function isEncrypted() {
  if (!isTauri) return false;
  return await invoke("is_encrypted");
}

export async function unlockPin(pin) {
  const s = await invoke("unlock", { pin });
  return JSON.parse(s);
}

export async function setPin(pin, data) {
  await invoke("set_pin", { pin, contents: JSON.stringify(data) });
}

export async function clearPin(pin, data) {
  await invoke("clear_pin", { pin, contents: JSON.stringify(data) });
}

// Notificação nativa do sistema (Windows toast). No navegador usa a
// Notification API; sem permissão, cai no console.
export async function notify(title, body) {
  try {
    if (isTauri) {
      let ok = await isPermissionGranted();
      if (!ok) ok = (await requestPermission()) === "granted";
      if (ok) sendNotification({ title, body });
      return;
    }
    if (typeof Notification !== "undefined") {
      if (Notification.permission === "default") await Notification.requestPermission();
      if (Notification.permission === "granted") {
        new Notification(title, { body });
        return;
      }
    }
    console.log("[notificação]", title, "—", body);
  } catch (e) {
    console.warn("notify falhou:", e);
  }
}

// Seleciona um extrato .ofx e devolve o texto bruto (null se cancelado).
export async function importOfx() {
  if (isTauri) return await invoke("import_ofx");
  return new Promise((resolve, reject) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".ofx";
    inp.onchange = () => {
      const f = inp.files[0];
      if (!f) return resolve(null);
      const rd = new FileReader();
      rd.onload = () => resolve(rd.result);
      rd.onerror = () => reject(new Error("Falha ao ler o arquivo"));
      rd.readAsText(f);
    };
    inp.click();
  });
}
