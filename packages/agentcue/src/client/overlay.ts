// Shadow DOM template and coordinate helpers live in ./dom.ts; bridge transport lives in ./transport.ts
import {
  buildCuePayload,
  clamp,
  computeStatusView,
  createOverlayDom,
  ICON_EYE,
  ICON_EYE_OFF,
  ICON_PAUSE,
  ICON_PICK,
  isMacPlatform,
  isTypingInField,
  loadActiveSessions,
  positionPopoverEl,
  renderAgentMenuDom,
  renderHoverElements,
  saveActiveSessions,
  syncBadgeDom,
  type ActivePin,
} from "./dom.ts";
import { extractPinContext } from "./extract.ts";
import {
  createHttpBridgeTransport,
  type BridgeTransport,
} from "./transport.ts";
import { formatCuePrompt } from "../shared/prompt.ts";
import {
  SUPPORTED_AGENTS,
  type AgentId,
  type DispatcherState,
  type ServerEvent,
} from "../shared/types.ts";

const STORAGE_AGENT_KEY = "agentcue:selected-agent";

export interface MountOverlayOptions {
  transport?: BridgeTransport;
  startActive?: boolean;
}

export interface OverlayInstance {
  togglePickMode: () => void;
  setActive: (next: boolean) => void;
  isActive: () => boolean;
}

export function mountOverlay(
  serverOrigin: string,
  options?: MountOverlayOptions
): OverlayInstance {
  const transport = options?.transport ?? createHttpBridgeTransport(serverOrigin);
  const isMac = isMacPlatform();
  const modEnterLabel = isMac ? "⌘↵" : "Ctrl+↵";
  const activateKeyLabel = isMac ? "⌘⇧F" : "Ctrl+Shift+F";
  const {
    host,
    hoverBox,
    hoverTag,
    pinsLayer,
    popover,
    popNum,
    popSel,
    popDelete,
    popInput,
    popSave,
    popSend,
    toastEl,
    agentMenu,
    agentMenuList,
    launcherBtn,
    launcherDot,
    launcherText,
    launcherCount,
    capsule,
    statusDot,
    pickBtn,
    agentBtn,
    agentLabel,
    contBtn,
    hideBtn,
    copyBtn,
    clearBtn,
    sendBtn,
    sendCount,
    collapseBtn,
  } = createOverlayDom(modEnterLabel, activateKeyLabel);

  let active = false;
  let pickMode = false;
  let markersHidden = false;
  let connected = false;
  let agentMenuOpen = false;
  let availableAgents: AgentId[] = [...SUPPORTED_AGENTS];
  let selectedAgent: AgentId =
    (localStorage.getItem(STORAGE_AGENT_KEY) as AgentId) || "agy";
  if (!SUPPORTED_AGENTS.includes(selectedAgent)) selectedAgent = "agy";
  const activeSessions = loadActiveSessions();

  let serverState: DispatcherState | null = null;
  let pins: ActivePin[] = [];
  const badgeEls = new Map<string, HTMLDivElement>();
  let activePinId: string | null = null;
  let hoveredEl: Element | null = null;
  const inFlightBatches = new Map<string, ActivePin[]>();
  const earlyCueErrors = new Map<string, string>();
  const earlyCueDones = new Set<string>();
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let copyTimer: ReturnType<typeof setTimeout> | null = null;

  function getAgentList(): AgentId[] {
    return availableAgents.length > 0 ? availableAgents : [...SUPPORTED_AGENTS];
  }

  function showToast(msg: string, isError = false, ms = 3200) {
    if (toastTimer) clearTimeout(toastTimer);
    toastEl.textContent = msg;
    toastEl.className = isError ? "toast visible error" : "toast visible";
    toastTimer = setTimeout(() => {
      toastEl.className = "toast";
    }, ms);
  }

  function setAgentMenuOpen(open: boolean) {
    agentMenuOpen = open;
    agentMenu.classList.toggle("visible", open);
    agentBtn.classList.toggle("menu-open", open);
  }

  function selectAgent(agent: AgentId, closeMenu = true) {
    selectedAgent = agent;
    localStorage.setItem(STORAGE_AGENT_KEY, selectedAgent);
    renderAgentOptions();
    renderControls();
    renderStatus();
    if (closeMenu) {
      setAgentMenuOpen(false);
    }
  }

  function resetCurrentSession() {
    if (!activeSessions.has(selectedAgent)) {
      showToast(`Next Cue for ${selectedAgent} will already start a new session`);
      return;
    }
    activeSessions.delete(selectedAgent);
    saveActiveSessions(activeSessions);
    renderControls();
    showToast(`Session reset · Next Cue starts a new ${selectedAgent} session`);
  }

  function cycleAgent(step = 1) {
    const list = getAgentList();
    const idx = list.indexOf(selectedAgent);
    const next = list[(idx + step + list.length) % list.length];
    selectAgent(next, false);
  }

  function renderAgentOptions() {
    const list = getAgentList();
    if (!list.includes(selectedAgent)) selectedAgent = list[0];
    renderAgentMenuDom(agentLabel, agentMenuList, list, selectedAgent, (agent) =>
      selectAgent(agent, true)
    );
  }

  function renderStatus() {
    const { dotClass, statusTip, compactRunning } = computeStatusView(
      connected,
      serverState,
      selectedAgent
    );
    statusDot.className = dotClass;
    launcherDot.className = dotClass;
    agentBtn.setAttribute("data-tip", statusTip);
    launcherText.textContent = compactRunning;
  }

  function renderControls() {
    launcherBtn.classList.toggle("hidden", active);
    capsule.classList.toggle("expanded", active);
    pinsLayer.classList.toggle("hidden", markersHidden);

    const picking = active && pickMode;
    pickBtn.classList.toggle("pick-active", picking);
    pickBtn.innerHTML = picking ? ICON_PAUSE : ICON_PICK;
    pickBtn.setAttribute("data-tip", picking ? "Pause Pick · P" : "Resume Pick · P");

    const inSession = activeSessions.has(selectedAgent);
    contBtn.classList.toggle("cont-active", inSession);
    contBtn.setAttribute(
      "data-tip",
      inSession ? "Reset Session (in session) · R" : "New Session (1st Cue)"
    );
    document.documentElement.style.cursor = picking ? "crosshair" : "";

    const committedCount = pins.filter((p) => p.note.trim().length > 0).length;
    const draftHasText = activePinId !== null && popInput.value.trim().length > 0;
    const effectiveCount = draftHasText
      ? pins.filter((p) => p.id !== activePinId && p.note.trim().length > 0).length + 1
      : committedCount;

    launcherCount.textContent = String(committedCount);
    launcherCount.classList.toggle("visible", !active && committedCount > 0);

    hideBtn.innerHTML = markersHidden ? ICON_EYE_OFF : ICON_EYE;
    hideBtn.classList.toggle("hide-active", markersHidden);
    hideBtn.setAttribute("data-tip", markersHidden ? "Show Pins · H" : "Hide Pins · H");
    hideBtn.disabled = pins.length === 0;

    sendCount.textContent = effectiveCount > 0 ? String(effectiveCount) : "";
    sendBtn.disabled = effectiveCount === 0;
    copyBtn.disabled = effectiveCount === 0;
    clearBtn.disabled = pins.length === 0;
  }

  function renderPins(glidePopover = false) {
    syncBadgeDom(pinsLayer, badgeEls, pins, activePinId, (pinId) => {
      if (!active) setActive(true);
      openPopover(pinId);
    });
    if (activePinId) {
      const current = pins.find((p) => p.id === activePinId);
      if (current) positionPopoverEl(popover, current, glidePopover);
    }
    renderControls();
  }

  function updateHoverBox(el: Element | null) {
    hoveredEl = el;
    renderHoverElements(hoverBox, hoverTag, el, active && pickMode && activePinId === null);
  }

  function openPopover(pinId: string) {
    const idx = pins.findIndex((p) => p.id === pinId);
    if (idx === -1) return;
    const pin = pins[idx];
    const wasVisible = popover.classList.contains("visible");
    markersHidden = false;
    setAgentMenuOpen(false);
    activePinId = pinId;
    popNum.textContent = `#${idx + 1}`;
    popSel.textContent = pin.context.sourceHint || pin.context.selector;
    popInput.value = pin.note;
    positionPopoverEl(popover, pin, wasVisible);
    if (!wasVisible) void popover.offsetWidth;
    popover.classList.add("visible");
    updateHoverBox(null);
    renderPins(wasVisible);
    popInput.focus();
    popInput.selectionStart = popInput.value.length;
  }

  function closePopover(commitText: boolean) {
    if (!activePinId) return;
    const pin = pins.find((p) => p.id === activePinId);
    if (pin) {
      if (commitText) {
        pin.note = popInput.value.trim();
      }
      if (!pin.note.trim()) {
        pins = pins.filter((p) => p.id !== pin.id);
      }
    }
    activePinId = null;
    popover.classList.remove("visible");
    popInput.blur();
    renderPins();
  }

  function setPickMode(next: boolean) {
    if (!next && activePinId) {
      closePopover(true);
    }
    pickMode = next;
    if (!pickMode) updateHoverBox(null);
    renderControls();
  }

  function setActive(next: boolean) {
    if (next) {
      active = true;
      markersHidden = false;
      pickMode = true;
      renderControls();
    } else {
      if (activePinId) closePopover(true);
      setAgentMenuOpen(false);
      pickMode = false;
      active = false;
      updateHoverBox(null);
      renderControls();
    }
  }

  function clearAllPins() {
    activePinId = null;
    popover.classList.remove("visible");
    pins = [];
    markersHidden = false;
    renderPins();
  }

  function toggleMarkers() {
    if (pins.length === 0) return;
    if (!markersHidden && activePinId) closePopover(true);
    markersHidden = !markersHidden;
    renderControls();
  }

  function gatherReadyPins(): ActivePin[] {
    if (activePinId) {
      closePopover(true);
    }
    return pins.filter((p) => p.note.trim().length > 0);
  }

  async function copyMarkdown() {
    const ready = gatherReadyPins();
    if (ready.length === 0) return;
    const md = formatCuePrompt(buildCuePayload(selectedAgent, activeSessions.has(selectedAgent), ready));
    await navigator.clipboard.writeText(md);
    if (copyTimer) clearTimeout(copyTimer);
    copyBtn.classList.add("copied");
    copyBtn.setAttribute("data-tip", "Copied ✓");
    copyTimer = setTimeout(() => {
      copyBtn.classList.remove("copied");
      copyBtn.setAttribute("data-tip", "Copy Markdown · C");
    }, 1600);
  }

  function restoreFailedBatch(batch: ActivePin[], reason: string, wasFirstInSession = false) {
    if (wasFirstInSession) {
      activeSessions.delete(selectedAgent);
      saveActiveSessions(activeSessions);
    }
    const existingIds = new Set(pins.map((p) => p.id));
    for (const item of batch) {
      if (!existingIds.has(item.id)) pins.push(item);
    }
    setActive(true);
    renderPins();
    showToast(`Cue failed — Pins restored: ${reason}`, true, 6500);
  }

  async function dispatchCue() {
    const ready = gatherReadyPins();
    if (ready.length === 0) return;
    if (!connected) {
      showToast("Local agentcue daemon is offline. Use Copy or start `npx agentcue`.", true, 5000);
      return;
    }

    const continueSession = activeSessions.has(selectedAgent);
    const wasFirstInSession = !continueSession;
    activeSessions.add(selectedAgent);
    saveActiveSessions(activeSessions);

    const payload = buildCuePayload(selectedAgent, continueSession, ready);
    const snapshot = [...ready];
    pins = [];
    setActive(false);
    renderPins();

    try {
      const data = await transport.sendCue(payload);
      if (!data.ok || !data.cueId) {
        restoreFailedBatch(snapshot, data.error || `HTTP ${data.status}`, wasFirstInSession);
        return;
      }
      if (earlyCueErrors.has(data.cueId)) {
        const errText = earlyCueErrors.get(data.cueId)!;
        earlyCueErrors.delete(data.cueId);
        restoreFailedBatch(snapshot, errText, wasFirstInSession);
        return;
      }
      if (!earlyCueDones.delete(data.cueId)) {
        inFlightBatches.set(data.cueId, snapshot);
        const qMsg = data.queuePosition && data.queuePosition > 1 ? ` (queued #${data.queuePosition})` : "";
        const sMsg = continueSession ? " (continue)" : " (new session)";
        showToast(`Sent ${snapshot.length} Pin(s) → ${selectedAgent}${sMsg}${qMsg}`);
      }
    } catch (err) {
      restoreFailedBatch(snapshot, err instanceof Error ? err.message : "Network error", wasFirstInSession);
    }
  }

  launcherBtn.addEventListener("click", () => setActive(true));
  collapseBtn.addEventListener("click", () => setActive(false));
  pickBtn.addEventListener("click", () => setPickMode(!pickMode));
  agentBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setAgentMenuOpen(!agentMenuOpen);
  });
  contBtn.addEventListener("click", () => resetCurrentSession());
  hideBtn.addEventListener("click", () => toggleMarkers());
  copyBtn.addEventListener("click", () => void copyMarkdown());
  clearBtn.addEventListener("click", () => clearAllPins());
  sendBtn.addEventListener("click", () => void dispatchCue());

  popInput.addEventListener("input", () => renderControls());
  popInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      void dispatchCue();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      closePopover(true);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closePopover(false);
    }
  });
  popSave.addEventListener("click", () => closePopover(true));
  popSend.addEventListener("click", () => void dispatchCue());
  popDelete.addEventListener("click", () => {
    if (!activePinId) return;
    pins = pins.filter((p) => p.id !== activePinId);
    activePinId = null;
    popover.classList.remove("visible");
    popInput.blur();
    renderPins();
  });

  function isOverlayEvent(e: Event): boolean {
    return e.composedPath().includes(host);
  }

  window.addEventListener(
    "mousemove",
    (e) => {
      if (!active || !pickMode || activePinId !== null || isOverlayEvent(e)) {
        if (isOverlayEvent(e)) updateHoverBox(null);
        return;
      }
      const raw = document.elementFromPoint(e.clientX, e.clientY);
      const target = raw === document.documentElement ? document.body || raw : raw;
      if (target && target !== host) {
        if (target !== hoveredEl) updateHoverBox(target);
      } else {
        updateHoverBox(null);
      }
    },
    { passive: true }
  );

  for (const evtName of ["pointerdown", "mousedown", "mouseup", "click"] as const) {
    window.addEventListener(
      evtName,
      (e) => {
        if (agentMenuOpen && evtName === "pointerdown" && !e.composedPath().includes(agentMenu) && !e.composedPath().includes(agentBtn)) {
          setAgentMenuOpen(false);
        }
        if (!active || !pickMode || isOverlayEvent(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (evtName !== "click") return;

        if (activePinId !== null) {
          closePopover(true);
        }
        const mouseEvt = e as MouseEvent;
        const raw = document.elementFromPoint(mouseEvt.clientX, mouseEvt.clientY);
        const target = raw === document.documentElement ? document.body || raw : raw;
        if (!target || target === host) return;

        const rect = target.getBoundingClientRect();
        const relX = rect.width > 0 ? clamp((mouseEvt.clientX - rect.left) / rect.width, 0.1, 0.9) : 0.5;
        const relY = rect.height > 0 ? clamp((mouseEvt.clientY - rect.top) / rect.height, 0.1, 0.9) : 0.5;
        const newPin: ActivePin = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          el: target,
          relX,
          relY,
          note: "",
          context: extractPinContext(target),
        };
        pins.push(newPin);
        openPopover(newPin.id);
      },
      { capture: true }
    );
  }

  window.addEventListener(
    "keydown",
    (e) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === "KeyF") {
        e.preventDefault();
        e.stopPropagation();
        setActive(!active);
        return;
      }
      if (!active) return;

      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        if (activePinId !== null || pins.some((p) => p.note.trim().length > 0)) {
          e.preventDefault();
          e.stopPropagation();
          void dispatchCue();
        }
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (activePinId !== null) {
          closePopover(false);
        } else if (agentMenuOpen) {
          setAgentMenuOpen(false);
        } else {
          setActive(false);
        }
        return;
      }

      if (!e.metaKey && !e.ctrlKey && !e.altKey && activePinId === null && !isTypingInField(e)) {
        if (e.code === "KeyA") {
          e.preventDefault();
          setAgentMenuOpen(!agentMenuOpen);
        } else if (agentMenuOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
          e.preventDefault();
          cycleAgent(e.key === "ArrowDown" ? 1 : -1);
        } else if (agentMenuOpen && e.key === "Enter") {
          e.preventDefault();
          setAgentMenuOpen(false);
        } else if (/^Digit[1-9]$/.test(e.code)) {
          const idx = Number(e.code.slice(5)) - 1;
          const list = getAgentList();
          if (idx < list.length) {
            e.preventDefault();
            selectAgent(list[idx], true);
          }
        } else if (e.code === "KeyP") {
          e.preventDefault();
          setPickMode(!pickMode);
        } else if (e.code === "KeyR") {
          e.preventDefault();
          resetCurrentSession();
        } else if (e.code === "KeyS" && pins.some((p) => p.note.trim().length > 0)) {
          e.preventDefault();
          void dispatchCue();
        } else if (e.code === "KeyC" && pins.some((p) => p.note.trim().length > 0)) {
          e.preventDefault();
          void copyMarkdown();
        } else if (e.code === "KeyX" && pins.length > 0) {
          e.preventDefault();
          clearAllPins();
        } else if (e.code === "KeyH" && pins.length > 0) {
          e.preventDefault();
          toggleMarkers();
        }
      }
    },
    { capture: true }
  );

  let rafPending = false;
  const scheduleReposition = () => {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      if (pins.length > 0) renderPins(false);
      if (active && pickMode && hoveredEl) updateHoverBox(hoveredEl);
    });
  };
  window.addEventListener("scroll", scheduleReposition, { capture: true, passive: true });
  window.addEventListener("resize", scheduleReposition, { passive: true });

  function connectSSE() {
    transport.subscribeEvents({
      onOpen: () => {
        connected = true;
        renderStatus();
      },
      onEvent: (event: ServerEvent) => {
        if (event.type === "state") {
          serverState = event.state;
          if (event.state.agents.length > 0) {
            availableAgents = event.state.agents;
            if (!localStorage.getItem(STORAGE_AGENT_KEY) && event.state.defaultAgent) {
              selectedAgent = event.state.defaultAgent;
            }
            renderAgentOptions();
          }
          renderStatus();
        } else if (event.type === "cue:done") {
          if (!inFlightBatches.delete(event.cueId)) {
            earlyCueDones.add(event.cueId);
          }
          showToast(`${event.agent} finished in ${(event.durationMs / 1000).toFixed(1)}s ✓`);
        } else if (event.type === "cue:error") {
          const failed = inFlightBatches.get(event.cueId);
          inFlightBatches.delete(event.cueId);
          if (failed) {
            restoreFailedBatch(failed, event.error);
          } else {
            earlyCueErrors.set(event.cueId, event.error);
          }
        }
      },
      onError: () => {
        connected = false;
        renderStatus();
      },
    });
  }

  renderAgentOptions();
  renderControls();
  renderStatus();
  connectSSE();
  if (options?.startActive) {
    setActive(true);
  }

  return {
    togglePickMode: () => setActive(!active),
    setActive,
    isActive: () => active,
  };
}
