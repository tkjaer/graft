// ── Theme Definitions ────────────────────────────────────────────────
// Each theme defines the full set of CSS variables used by the web app.
// Applied via document.documentElement.style.setProperty().

export interface Theme {
  name: string;
  type: "light" | "dark";
  colors: Record<string, string>;
}

const BASE_LIGHT = {
  "--comment-highlight": "rgba(255, 212, 0, 0.2)",
  "--comment-border": "rgba(255, 212, 0, 0.6)",
  "--suggestion-highlight": "rgba(0, 200, 80, 0.12)",
  "--suggestion-border": "rgba(0, 200, 80, 0.5)",
  "--diff-del-bg": "rgba(255, 0, 0, 0.08)",
  "--diff-ins-bg": "rgba(0, 200, 0, 0.08)",
};

const BASE_DARK = {
  "--comment-highlight": "rgba(255, 212, 0, 0.15)",
  "--comment-border": "rgba(255, 212, 0, 0.5)",
  "--suggestion-highlight": "rgba(0, 200, 80, 0.1)",
  "--suggestion-border": "rgba(0, 200, 80, 0.4)",
  "--diff-del-bg": "rgba(255, 0, 0, 0.08)",
  "--diff-ins-bg": "rgba(0, 200, 0, 0.08)",
};

export const themes: Record<string, Theme> = {
  "github-light": {
    name: "GitHub Light",
    type: "light",
    colors: {
      ...BASE_LIGHT,
      "--bg": "#ffffff",
      "--fg": "#1f2328",
      "--bg-secondary": "#f6f8fa",
      "--border": "#d0d7de",
      "--border-light": "#d8dee4",
      "--text-muted": "#656d76",
      "--link": "#0969da",
      "--btn-bg": "#1f883d",
      "--btn-fg": "#ffffff",
      "--btn-hover": "#1a7f37",
      "--input-bg": "#ffffff",
      "--input-border": "#d0d7de",
      "--code-bg": "#eff1f3",
      "--sidebar-bg": "#f6f8fa",
      "--diff-del-fg": "#cf222e",
      "--diff-ins-fg": "#1a7f37",
      "--hover-bg": "rgba(208, 215, 222, 0.32)",
      "--flash-bg": "rgba(255, 212, 0, 0.3)",
      // Syntax
      "--syn-keyword": "#cf222e",
      "--syn-comment": "#6e7781",
      "--syn-string": "#0a3069",
      "--syn-literal": "#0550ae",
      "--syn-atom": "#0550ae",
      "--syn-variable": "#953800",
      "--syn-type": "#953800",
      "--syn-class": "#953800",
      "--syn-meta": "#6e7781",
      "--syn-heading": "#0550ae",
      "--syn-invalid": "#cf222e",
    },
  },

  "github-dark": {
    name: "GitHub Dark",
    type: "dark",
    colors: {
      ...BASE_DARK,
      "--bg": "#0d1117",
      "--fg": "#e6edf3",
      "--bg-secondary": "#161b22",
      "--border": "#30363d",
      "--border-light": "#21262d",
      "--text-muted": "#8b949e",
      "--link": "#58a6ff",
      "--btn-bg": "#238636",
      "--btn-fg": "#ffffff",
      "--btn-hover": "#2ea043",
      "--input-bg": "#0d1117",
      "--input-border": "#30363d",
      "--code-bg": "#161b22",
      "--sidebar-bg": "#010409",
      "--diff-del-fg": "#f85149",
      "--diff-ins-fg": "#3fb950",
      "--hover-bg": "rgba(177, 186, 196, 0.12)",
      "--flash-bg": "rgba(255, 212, 0, 0.15)",
      // Syntax
      "--syn-keyword": "#ff7b72",
      "--syn-comment": "#8b949e",
      "--syn-string": "#a5d6ff",
      "--syn-literal": "#79c0ff",
      "--syn-atom": "#79c0ff",
      "--syn-variable": "#ffa657",
      "--syn-type": "#ffa657",
      "--syn-class": "#ffa657",
      "--syn-meta": "#8b949e",
      "--syn-heading": "#79c0ff",
      "--syn-invalid": "#f85149",
    },
  },

  "github-dimmed": {
    name: "GitHub Dark Dimmed",
    type: "dark",
    colors: {
      ...BASE_DARK,
      "--bg": "#22272e",
      "--fg": "#adbac7",
      "--bg-secondary": "#2d333b",
      "--border": "#444c56",
      "--border-light": "#373e47",
      "--text-muted": "#768390",
      "--link": "#539bf5",
      "--btn-bg": "#347d39",
      "--btn-fg": "#ffffff",
      "--btn-hover": "#46954a",
      "--input-bg": "#22272e",
      "--input-border": "#444c56",
      "--code-bg": "#2d333b",
      "--sidebar-bg": "#1c2128",
      "--diff-del-fg": "#e5534b",
      "--diff-ins-fg": "#57ab5a",
      "--hover-bg": "rgba(144, 157, 171, 0.12)",
      "--flash-bg": "rgba(255, 212, 0, 0.12)",
      // Syntax
      "--syn-keyword": "#f47067",
      "--syn-comment": "#768390",
      "--syn-string": "#96d0ff",
      "--syn-literal": "#6cb6ff",
      "--syn-atom": "#6cb6ff",
      "--syn-variable": "#f69d50",
      "--syn-type": "#f69d50",
      "--syn-class": "#f69d50",
      "--syn-meta": "#768390",
      "--syn-heading": "#6cb6ff",
      "--syn-invalid": "#e5534b",
    },
  },

  dracula: {
    name: "Dracula",
    type: "dark",
    colors: {
      ...BASE_DARK,
      "--bg": "#282a36",
      "--fg": "#f8f8f2",
      "--bg-secondary": "#21222c",
      "--border": "#44475a",
      "--border-light": "#383a46",
      "--text-muted": "#6272a4",
      "--link": "#8be9fd",
      "--btn-bg": "#50fa7b",
      "--btn-fg": "#282a36",
      "--btn-hover": "#5af78e",
      "--input-bg": "#282a36",
      "--input-border": "#44475a",
      "--code-bg": "#21222c",
      "--sidebar-bg": "#191a21",
      "--diff-del-fg": "#ff5555",
      "--diff-ins-fg": "#50fa7b",
      "--hover-bg": "rgba(98, 114, 164, 0.2)",
      "--flash-bg": "rgba(255, 184, 108, 0.2)",
      // Syntax
      "--syn-keyword": "#ff79c6",
      "--syn-comment": "#6272a4",
      "--syn-string": "#f1fa8c",
      "--syn-literal": "#bd93f9",
      "--syn-atom": "#bd93f9",
      "--syn-variable": "#f8f8f2",
      "--syn-type": "#8be9fd",
      "--syn-class": "#8be9fd",
      "--syn-meta": "#f8f8f2",
      "--syn-heading": "#bd93f9",
      "--syn-invalid": "#ff5555",
    },
  },

  "solarized-light": {
    name: "Solarized Light",
    type: "light",
    colors: {
      ...BASE_LIGHT,
      "--bg": "#fdf6e3",
      "--fg": "#657b83",
      "--bg-secondary": "#eee8d5",
      "--border": "#93a1a1",
      "--border-light": "#93a1a1",
      "--text-muted": "#93a1a1",
      "--link": "#268bd2",
      "--btn-bg": "#859900",
      "--btn-fg": "#fdf6e3",
      "--btn-hover": "#6d8200",
      "--input-bg": "#fdf6e3",
      "--input-border": "#93a1a1",
      "--code-bg": "#eee8d5",
      "--sidebar-bg": "#eee8d5",
      "--diff-del-fg": "#dc322f",
      "--diff-ins-fg": "#859900",
      "--hover-bg": "rgba(147, 161, 161, 0.2)",
      "--flash-bg": "rgba(181, 137, 0, 0.2)",
      // Syntax
      "--syn-keyword": "#859900",
      "--syn-comment": "#93a1a1",
      "--syn-string": "#2aa198",
      "--syn-literal": "#d33682",
      "--syn-atom": "#d33682",
      "--syn-variable": "#b58900",
      "--syn-type": "#cb4b16",
      "--syn-class": "#cb4b16",
      "--syn-meta": "#93a1a1",
      "--syn-heading": "#268bd2",
      "--syn-invalid": "#dc322f",
    },
  },
};

// ── Theme Application ────────────────────────────────────────────────

export const THEME_STORAGE_KEY = "graft-theme";
export const SYSTEM_THEME = "system";

export function getSystemThemeId(): string {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "github-dark"
    : "github-light";
}

export function resolveTheme(themeId: string): Theme {
  if (themeId === SYSTEM_THEME) {
    return themes[getSystemThemeId()];
  }
  return themes[themeId] ?? themes["github-light"];
}

export function applyTheme(themeId: string): void {
  const resolved = themeId === SYSTEM_THEME ? getSystemThemeId() : themeId;
  const theme = themes[resolved] ?? themes["github-light"];
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme.colors)) {
    root.style.setProperty(key, value);
  }
  root.setAttribute("data-theme", resolved);
  root.setAttribute("data-theme-type", theme.type);
}

export function getSavedTheme(): string {
  return localStorage.getItem(THEME_STORAGE_KEY) ?? SYSTEM_THEME;
}

export function saveTheme(themeId: string): void {
  localStorage.setItem(THEME_STORAGE_KEY, themeId);
}

/** Apply saved theme and listen for system changes. Returns cleanup fn. */
export function initTheme(): () => void {
  const themeId = getSavedTheme();
  applyTheme(themeId);

  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  const listener = () => {
    if (getSavedTheme() === SYSTEM_THEME) {
      applyTheme(SYSTEM_THEME);
    }
  };
  mql.addEventListener("change", listener);
  return () => mql.removeEventListener("change", listener);
}

/** Build the <select> HTML for the theme picker. */
export function themePickerHtml(selectedId?: string): string {
  const current = selectedId ?? getSavedTheme();
  const opts = [
    `<option value="system"${current === SYSTEM_THEME ? " selected" : ""}>System</option>`,
    ...Object.entries(themes).map(
      ([id, t]) =>
        `<option value="${id}"${current === id ? " selected" : ""}>${t.name}</option>`,
    ),
  ];
  return `<select class="theme-select" id="theme-select" title="Theme">${opts.join("")}</select>`;
}

/** Bind change handler to theme <select>. Call after rendering. */
export function bindThemePicker(): void {
  const el = document.getElementById("theme-select") as HTMLSelectElement | null;
  if (!el) return;
  el.addEventListener("change", () => {
    saveTheme(el.value);
    applyTheme(el.value);
  });
}
