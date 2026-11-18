/** Light / Dark theme toggle module */

export type Theme = "light" | "dark";

const STORAGE_KEY = "agentcue:theme";

export function detectTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function setTheme(theme: Theme, persist = true) {
  if (persist) {
    localStorage.setItem(STORAGE_KEY, theme);
  }
  applyTheme(theme);
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  const btn = document.getElementById("theme-toggle") as HTMLButtonElement | null;
  if (btn) {
    const nextLabel = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
    btn.setAttribute("aria-label", nextLabel);
    btn.setAttribute("title", nextLabel);
    btn.setAttribute("aria-pressed", String(theme === "dark"));
  }
}

export function initThemeToggle(): Theme {
  const initial = detectTheme();
  applyTheme(initial);

  const btn = document.getElementById("theme-toggle");
  btn?.addEventListener("click", () => {
    const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    setTheme(current === "dark" ? "light" : "dark");
  });

  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", (e) => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      applyTheme(e.matches ? "dark" : "light");
    }
  });

  return initial;
}
