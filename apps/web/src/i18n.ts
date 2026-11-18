/** Bilingual i18n module for EN / 中文 */

export type Lang = "en" | "zh";

const STORAGE_KEY = "agentcue:lang";

const TITLES: Record<Lang, string> = {
  en: "agentcue — Push visual UI Cues straight to your Agent CLI",
  zh: "agentcue — 将视觉 UI 指令直接推送到 Agent CLI",
};

let currentLang: Lang = "en";

export function getCurrentLang(): Lang {
  return currentLang;
}

export function detectLang(): Lang {
  // 1. Explicit query param
  const params = new URLSearchParams(window.location.search);
  const qLang = params.get("lang");
  if (qLang === "zh" || qLang === "en") return qLang;

  // 2. localStorage preference
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "zh" || saved === "en") return saved;

  // 3. If served at /zh or /zh/ (including under a subpath like /agentcue/zh/), or <html lang="zh-CN">, default to zh
  const path = window.location.pathname;
  if (/(^|\/)zh(\/|$)/.test(path)) return "zh";
  if (document.documentElement.lang.startsWith("zh")) return "zh";

  // 4. Browser language
  if (navigator.language.startsWith("zh")) return "zh";

  return "en";
}

export function setLang(lang: Lang) {
  currentLang = lang;
  localStorage.setItem(STORAGE_KEY, lang);
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  applyLang(lang);
}

function applyLang(lang: Lang) {
  // Update text-only bilingual elements
  const els = document.querySelectorAll<HTMLElement>("[data-en][data-zh]");
  for (const el of els) {
    const text = el.getAttribute(`data-${lang}`);
    if (text !== null) el.textContent = text;
  }
  // Update HTML bilingual elements
  const htmlEls = document.querySelectorAll<HTMLElement>("[data-en-html][data-zh-html]");
  for (const el of htmlEls) {
    const html = el.getAttribute(`data-${lang}-html`);
    if (html !== null) el.innerHTML = html;
  }
  // Update toggle buttons
  const toggleBtns = document.querySelectorAll<HTMLButtonElement>(".lang-btn");
  for (const btn of toggleBtns) {
    btn.classList.toggle("active", btn.dataset.lang === lang);
  }
  // Update document title
  document.title = TITLES[lang];
}

export function initLangToggle() {
  const lang = detectLang();
  currentLang = lang;
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";

  const toggleBtns = document.querySelectorAll<HTMLButtonElement>(".lang-btn");
  for (const btn of toggleBtns) {
    btn.addEventListener("click", () => {
      const target = btn.dataset.lang as Lang;
      if (target) setLang(target);
    });
  }

  applyLang(lang);
  return lang;
}
