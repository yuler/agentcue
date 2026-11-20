import { initLangToggle } from "./i18n.ts";
import { initIntro } from "./intro/index.ts";
import { initSandbox, resetSandboxTargets } from "./sandbox.ts";
import { initThemeToggle } from "./theme.ts";

function initCopyButtons() {
  const buttons = document.querySelectorAll<HTMLButtonElement>("[data-copy]");
  buttons.forEach((btn) => {
    btn.addEventListener("click", async () => {
      const text = btn.getAttribute("data-copy") || "";
      const status = btn.querySelector<HTMLElement>(".copy-status");
      try {
        await navigator.clipboard.writeText(text);
        if (status) {
          const prev = status.textContent;
          status.textContent = "Copied ✓";
          setTimeout(() => {
            status.textContent = prev;
          }, 1600);
        }
      } catch {
        // ignore clipboard failure
      }
    });
  });
}

function initPickToggle() {
  const btn = document.getElementById("try-pick-toggle");
  btn?.addEventListener("click", (e) => {
    e.stopPropagation();
    window.__AGENTCUE_INSTANCE__?.togglePickMode();
  });
}

function initResetButton() {
  const btn = document.getElementById("sandbox-reset-btn");
  btn?.addEventListener("click", (e) => {
    e.stopPropagation();
    resetSandboxTargets();
  });
}

function initQuickstartTabs() {
  const tabs = document.querySelectorAll<HTMLButtonElement>(".qs-tab");
  const panels = document.querySelectorAll<HTMLElement>(".qs-panel");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.tab;
      tabs.forEach((t) => t.classList.toggle("active", t === tab));
      panels.forEach((p) => p.classList.toggle("active", p.id === target));
    });
  });
}

function bootstrap() {
  initThemeToggle();
  initSandbox();
  initIntro();
  initLangToggle();
  initCopyButtons();
  initPickToggle();
  initResetButton();
  initQuickstartTabs();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
} else {
  bootstrap();
}
