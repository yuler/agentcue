import {
  DEFAULT_BRIDGE_ORIGIN,
  DEFAULT_EXTENSION_SETTINGS,
  normalizeBridgeOrigin,
  normalizeSettings,
  STORAGE_SETTINGS_KEY,
  type BridgeHealthResult,
} from "./protocol.ts";

const originInput = document.getElementById("bridge-origin") as HTMLInputElement;
const resetBtn = document.getElementById("reset-origin-btn") as HTMLButtonElement;
const saveBtn = document.getElementById("save-btn") as HTMLButtonElement;
const autoMountToggle = document.getElementById("auto-mount-toggle") as HTMLInputElement;
const statusPill = document.getElementById("bridge-status-pill") as HTMLDivElement;
const statusText = document.getElementById("bridge-status-text") as HTMLSpanElement;
const detailsEl = document.getElementById("bridge-details") as HTMLDivElement;

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
      statusText.textContent = "Bridge Online";
      const agents =
        res.state.agents.length > 0 ? res.state.agents.join(", ") : "none detected";
      renderBridgeDetails([
        ["Workspace: ", res.state.cwd],
        ["Agents: ", agents],
      ]);
    } else {
      statusPill.className = "status-pill offline";
      statusText.textContent = "Bridge Offline";
      detailsEl.textContent = "";
      detailsEl.appendChild(document.createTextNode("Daemon not reachable at "));
      const originStrong = document.createElement("strong");
      originStrong.textContent = bridgeOrigin;
      detailsEl.appendChild(originStrong);
      detailsEl.appendChild(document.createTextNode(". Run "));
      const cmdStrong = document.createElement("strong");
      cmdStrong.textContent = "npx agentcue";
      detailsEl.appendChild(cmdStrong);
      detailsEl.appendChild(
        document.createTextNode(" in your terminal (Copy Markdown still works offline).")
      );
    }
  } catch {
    statusPill.className = "status-pill offline";
    statusText.textContent = "Bridge Offline";
  }
}

async function loadCurrentSettings() {
  try {
    const stored = await chrome.storage.local.get(STORAGE_SETTINGS_KEY);
    const settings = normalizeSettings(stored[STORAGE_SETTINGS_KEY]);
    originInput.value = settings.bridgeOrigin;
    autoMountToggle.checked = settings.autoMountLocalhost;
    await checkBridgeStatus(settings.bridgeOrigin);
  } catch {
    originInput.value = DEFAULT_EXTENSION_SETTINGS.bridgeOrigin;
    autoMountToggle.checked = DEFAULT_EXTENSION_SETTINGS.autoMountLocalhost;
  }
}

async function persistSettings() {
  const bridgeOrigin = normalizeBridgeOrigin(originInput.value);
  originInput.value = bridgeOrigin;
  const next = {
    bridgeOrigin,
    autoMountLocalhost: autoMountToggle.checked,
  };
  await chrome.storage.local.set({ [STORAGE_SETTINGS_KEY]: next });
  const prevLabel = saveBtn.textContent;
  saveBtn.textContent = "Saved ✓";
  setTimeout(() => {
    saveBtn.textContent = prevLabel;
  }, 1200);
  await checkBridgeStatus(bridgeOrigin);
}

saveBtn.addEventListener("click", () => void persistSettings());
originInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    void persistSettings();
  }
});
resetBtn.addEventListener("click", () => {
  originInput.value = DEFAULT_BRIDGE_ORIGIN;
  void persistSettings();
});
autoMountToggle.addEventListener("change", () => void persistSettings());

void loadCurrentSettings();
