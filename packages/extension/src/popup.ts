import {
  DEFAULT_BRIDGE_ORIGIN,
  DEFAULT_EXTENSION_SETTINGS,
  normalizeBridgeOrigin,
  normalizeSettings,
  STORAGE_SETTINGS_KEY,
  type BridgeHealthResult,
  type EmbeddedSdkSource,
  type TabStateResult,
  type TabToggleResult,
} from "./protocol.ts";

const brandName = document.getElementById("brand-name") as HTMLSpanElement;
const envBadge = document.getElementById("env-badge") as HTMLSpanElement;
const toggleBtn = document.getElementById("toggle-pick-btn") as HTMLButtonElement;
const toggleLabel = document.getElementById("toggle-pick-label") as HTMLSpanElement;
const shortcutKbd = document.getElementById("shortcut-kbd") as HTMLSpanElement;
const extStateRow = document.getElementById("ext-state-row") as HTMLLabelElement;
const extStateText = document.getElementById("ext-state-text") as HTMLSpanElement;
const toggleEnabledSwitch = document.getElementById("toggle-enabled-switch") as HTMLInputElement;
const floatingBarRow = document.getElementById("floating-bar-row") as HTMLLabelElement;
const toggleFloatingSwitch = document.getElementById("toggle-floating-switch") as HTMLInputElement;
const conflictTip = document.getElementById("conflict-tip") as HTMLDivElement;
const originInput = document.getElementById("bridge-origin") as HTMLInputElement;
const resetBtn = document.getElementById("reset-origin-btn") as HTMLButtonElement;
const saveBtn = document.getElementById("save-btn") as HTMLButtonElement;
const statusPill = document.getElementById("bridge-status-pill") as HTMLDivElement;
const statusText = document.getElementById("bridge-status-text") as HTMLSpanElement;
const detailsEl = document.getElementById("bridge-details") as HTMLDivElement;

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
shortcutKbd.textContent = isMac ? "⌘⇧F" : "Ctrl+Shift+F";

const manifest = chrome.runtime.getManifest?.();
const isLocalBuild = Boolean(
  manifest?.short_name?.includes("(local)") ||
    manifest?.version_name?.includes("local")
);
brandName.textContent = isLocalBuild ? "agentcue(local)" : "agentcue";
if (manifest?.version) {
  envBadge.textContent = `v${manifest.version}`;
  envBadge.classList.toggle("local", isLocalBuild);
  envBadge.hidden = false;
}

let currentTabId: number | null = null;
let currentTabUrl: string | undefined;
let currentEnabled = true;
let currentShowFloatingBar = true;
let isConflictLocked = false;

function formatEmbeddedSource(source?: EmbeddedSdkSource): string {
  if (source === "vite") return "agentcue/vite";
  if (source === "script") return "agentcue script";
  return "embedded agentcue";
}

function renderBridgeDetails(lines: Array<[label: string, value: string]>) {
  detailsEl.textContent = "";
  lines.forEach(([label, value], idx) => {
    if (idx > 0) detailsEl.appendChild(document.createElement("br"));
    const strong = document.createElement("strong");
    strong.textContent = label;
    detailsEl.appendChild(strong);
    detailsEl.appendChild(document.createTextNode(value));
  });
}

function renderTabState(state: TabStateResult) {
  currentEnabled = state.enabled;
  currentShowFloatingBar = state.showFloatingBar;
  isConflictLocked = state.embedded;

  const effectiveEnabled = state.enabled && !state.embedded;
  toggleBtn.hidden = !effectiveEnabled;
  if (effectiveEnabled) {
    toggleBtn.disabled = !state.injectable;
    toggleBtn.classList.toggle("active", state.injectable && state.active);
    shortcutKbd.hidden = !state.injectable;
    toggleLabel.textContent = !state.injectable
      ? "Unavailable on this page"
      : state.active
        ? "Stop Picking"
        : "Start Picking";
  }

  extStateRow.classList.toggle("disabled", !effectiveEnabled);
  extStateRow.classList.toggle("locked", state.embedded);
  toggleEnabledSwitch.checked = effectiveEnabled;
  toggleEnabledSwitch.disabled = state.embedded;
  extStateText.textContent = effectiveEnabled
    ? "Extension enabled"
    : "Extension disabled";

  floatingBarRow.hidden = !effectiveEnabled;
  toggleFloatingSwitch.checked = state.showFloatingBar;

  if (state.embedded) {
    conflictTip.textContent = `Detected ${formatEmbeddedSource(state.embeddedSource)} on this page — auto-disabled.`;
    conflictTip.hidden = false;
  } else {
    conflictTip.hidden = true;
  }
}

async function checkBridgeStatus(bridgeOrigin: string) {
  statusPill.className = "status-pill";
  statusText.textContent = "Checking…";

  try {
    const res = await chrome.runtime.sendMessage<BridgeHealthResult>({
      type: "ext:check-bridge",
      bridgeOrigin,
    });

    if (res?.ok && res.state) {
      statusPill.className = "status-pill online";
      statusText.textContent = "Online";
      const agents =
        res.state.agents.length > 0 ? res.state.agents.join(", ") : "none";
      renderBridgeDetails([
        ["Workspace: ", res.state.cwd],
        ["Agents: ", agents],
      ]);
    } else {
      statusPill.className = "status-pill offline";
      statusText.textContent = "Offline";
      detailsEl.textContent = "";
      detailsEl.appendChild(document.createTextNode("Run "));
      const cmdStrong = document.createElement("strong");
      cmdStrong.textContent = "npx agentcue";
      detailsEl.appendChild(cmdStrong);
      detailsEl.appendChild(
        document.createTextNode(" in your workspace (Copy still works offline).")
      );
    }
  } catch {
    statusPill.className = "status-pill offline";
    statusText.textContent = "Offline";
  }
}

async function loadTabState() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (typeof tab?.id !== "number") {
      renderTabState({
        injectable: false,
        active: false,
        embedded: false,
        enabled: currentEnabled,
        showFloatingBar: currentShowFloatingBar,
      });
      return;
    }
    currentTabId = tab.id;
    currentTabUrl = tab.url;
    const state = await chrome.runtime.sendMessage<TabStateResult>({
      type: "ext:tab-state",
      tabId: tab.id,
      tabUrl: tab.url,
    });
    renderTabState(
      state ?? {
        injectable: false,
        active: false,
        embedded: false,
        enabled: currentEnabled,
        showFloatingBar: currentShowFloatingBar,
      }
    );
  } catch {
    renderTabState({
      injectable: false,
      active: false,
      embedded: false,
      enabled: currentEnabled,
      showFloatingBar: currentShowFloatingBar,
    });
  }
}

async function loadCurrentSettings() {
  try {
    const stored = await chrome.storage.local.get(STORAGE_SETTINGS_KEY);
    const settings = normalizeSettings(stored[STORAGE_SETTINGS_KEY]);
    currentEnabled = settings.enabled;
    currentShowFloatingBar = settings.showFloatingBar;
    originInput.value = settings.bridgeOrigin;
    await checkBridgeStatus(settings.bridgeOrigin);
  } catch {
    originInput.value = DEFAULT_EXTENSION_SETTINGS.bridgeOrigin;
  }
}

async function persistOrigin() {
  const bridgeOrigin = normalizeBridgeOrigin(originInput.value);
  originInput.value = bridgeOrigin;
  await chrome.storage.local.set({
    [STORAGE_SETTINGS_KEY]: {
      bridgeOrigin,
      enabled: currentEnabled,
      showFloatingBar: currentShowFloatingBar,
    },
  });
  const prevLabel = saveBtn.textContent;
  saveBtn.textContent = "✓";
  saveBtn.classList.add("saved");
  setTimeout(() => {
    saveBtn.textContent = prevLabel;
    saveBtn.classList.remove("saved");
  }, 1100);
  await checkBridgeStatus(bridgeOrigin);
}

toggleBtn.addEventListener("click", () => {
  if (currentTabId === null || toggleBtn.disabled) return;
  void (async () => {
    const res = await chrome.runtime.sendMessage<TabToggleResult>({
      type: "ext:toggle-tab",
      tabId: currentTabId,
      tabUrl: currentTabUrl,
    });
    if (res?.ok) {
      window.close();
    } else {
      await loadTabState();
    }
  })();
});

toggleEnabledSwitch.addEventListener("change", () => {
  if (isConflictLocked) {
    toggleEnabledSwitch.checked = false;
    return;
  }
  const nextEnabled = toggleEnabledSwitch.checked;
  toggleEnabledSwitch.disabled = true;
  void (async () => {
    try {
      const state = await chrome.runtime.sendMessage<TabStateResult>({
        type: "ext:update-settings",
        enabled: nextEnabled,
        tabId: currentTabId ?? undefined,
        tabUrl: currentTabUrl,
      });
      if (state) {
        renderTabState(state);
      } else {
        await loadTabState();
      }
    } finally {
      if (!isConflictLocked) {
        toggleEnabledSwitch.disabled = false;
      }
    }
  })();
});

toggleFloatingSwitch.addEventListener("change", () => {
  const nextShow = toggleFloatingSwitch.checked;
  toggleFloatingSwitch.disabled = true;
  void (async () => {
    try {
      const state = await chrome.runtime.sendMessage<TabStateResult>({
        type: "ext:update-settings",
        showFloatingBar: nextShow,
        tabId: currentTabId ?? undefined,
        tabUrl: currentTabUrl,
      });
      if (state) {
        renderTabState(state);
      } else {
        await loadTabState();
      }
    } finally {
      toggleFloatingSwitch.disabled = false;
    }
  })();
});

saveBtn.addEventListener("click", () => void persistOrigin());
originInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    void persistOrigin();
  }
});
resetBtn.addEventListener("click", () => {
  originInput.value = DEFAULT_BRIDGE_ORIGIN;
  void persistOrigin();
});

void Promise.all([loadTabState(), loadCurrentSettings()]);
