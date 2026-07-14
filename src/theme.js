// Paleta customizável (estilo Fan Control): presets + cores individuais.
export const THEME_VARS = [
  { key: "bg", label: "Fundo" },
  { key: "surface", label: "Cartões" },
  { key: "text", label: "Texto" },
  { key: "muted", label: "Texto secundário" },
  { key: "accent", label: "Destaque" },
  { key: "pos", label: "Positivo" },
  { key: "neg", label: "Negativo" },
  { key: "border", label: "Bordas" },
];

export const PRESETS = {
  escuro: {
    label: "Escuro",
    bg: "#0f1115", surface: "#171a21", text: "#e8eaf0", muted: "#8b93a7",
    accent: "#4f8cff", pos: "#3fce7c", neg: "#ff5c6c", border: "#262b36",
  },
  meianoite: {
    label: "Meia-noite",
    bg: "#0a0e1a", surface: "#121729", text: "#dfe6ff", muted: "#7d87ab",
    accent: "#8b6cff", pos: "#2dd4a7", neg: "#fb7185", border: "#1f2742",
  },
  verde: {
    label: "Terminal",
    bg: "#0b100d", surface: "#121a15", text: "#dcefe2", muted: "#7d947f",
    accent: "#2fbf71", pos: "#4ade80", neg: "#f87171", border: "#213028",
  },
  claro: {
    label: "Claro",
    bg: "#f4f5f8", surface: "#ffffff", text: "#1c2130", muted: "#68708a",
    accent: "#2563eb", pos: "#0f8a4f", neg: "#d3243e", border: "#e2e5ee",
  },
};

export function themeColors(theme) {
  const preset = PRESETS[theme?.preset] || PRESETS.escuro;
  return { ...preset, ...(theme?.colors || {}) };
}

export function applyTheme(theme) {
  const c = themeColors(theme);
  const r = document.documentElement.style;
  for (const v of THEME_VARS) r.setProperty("--" + v.key, c[v.key]);
}
