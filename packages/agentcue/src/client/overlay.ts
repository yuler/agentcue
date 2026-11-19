// Shadow DOM template lives in ./dom.ts; icon feedback in ./feedback.ts; shortcuts in ./shortcuts.ts; transport in ./transport.ts
import {
  buildCuePayload,
  computeStatusView,
  createBrowserOverlayStateStore,
  createOverlayDom,
  createPinFromPoint,
  ICON_EYE,
  ICON_EYE_OFF,
  ICON_PAUSE,
  ICON_PICK,
  isMacPlatform,
  positionPopoverEl,
  renderAgentMenuDom,
  renderHoverElements,
  syncBadgeDom,
  type ActivePin,
} from "./dom.ts";
import { createOverlayFeedback } from "./feedback.ts";
import { handleOverlayKeydown } from "./shortcuts.ts";
import {
  createHttpBridgeTransport,
  type MountOverlayOptions,
  type OverlayInstance,
} from "./transport.ts";
import { formatCuePrompt } from "../shared/prompt.ts";
import {
  SUPPORTED_AGENTS,
  type AgentId,
  type DispatcherState,
  type ServerEvent,
} from "../shared/types.ts";

export type { MountOverlayOptions, OverlayInstance };

export function mountOverlay(
  serverOrigin: string,
  options?: MountOverlayOptions
): OverlayInstance {
  const transport = options?.transport ?? createHttpBridgeTransport(serverOrigin);
  const stateStore = options?.stateStore ?? createBrowserOverlayStateStore();
  const requireTrustedSend = options?.requireTrustedSend ?? false;
  const resolveFrameworkHints = options?.resolveFrameworkHints;
  let hideLauncherWhenIdle = options?.hideLauncherWhenIdle ?? false;
  const onActiveChange = options?.onActiveChange;
  const isMac = isMacPlatform();
  const modEnterLabel = isMac ? "⌘↵" : "Ctrl+↵";
  const activateKeyLabel = isMac ? "⌘⇧F" : "Ctrl+Shift+F";
  const defaultSendTip = `Send Cue · S / ${modEnterLabel}`;
  const defaultLauncherTitle = `Activate agentcue (${activateKeyLabel})`;
  const {
    host,
    shadow,
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
  } = createOverlayDom(modEnterLabel, activateKeyLabel, options?.shadowMode ?? "open");

  let active = false;
  let pickMode = false;
  let markersHidden = false;
  let connected = false;
  let agentMenuOpen = false;
  let availableAgents: AgentId[] = [...SUPPORTED_AGENTS];
  let selectedAgent: AgentId =
    (stateStore.getSelectedAgent() as AgentId) || "agy";
  if (!SUPPORTED_AGENTS.includes(selectedAgent)) selectedAgent = "agy";
  const activeSessions = stateStore.loadActiveSessions();

  let serverState: DispatcherState | null = null;
  let pins: ActivePin[] = [];
  const badgeEls = new Map<string, HTMLDivElement>();
  let activePinId: string | null = null;
  let hoveredEl: Element | null = null;
  const inFlightBatches = new Map<string, ActivePin[]>();
  const earlyCueErrors = new Map<string, string>();
  const earlyCueDones = new Set<string>();
  const feedback = createOverlayFeedback({
    copyBtn,
    contBtn,
    sendBtn,
    launcherBtn,
    defaultSendTip,
    defaultLauncherTitle,
    onRenderControls: () => renderControls(),
  });

  function getAgentList(): AgentId[] {
    return availableAgents.length > 0 ? availableAgents : [...SUPPORTED_AGENTS];
  }

  function setAgentMenuOpen(open: boolean) {
    agentMenuOpen = open;
    agentMenu.classList.toggle("visible", open);
    agentBtn.classList.toggle("menu-open", open);
  }

  function selectAgent(agent: AgentId, closeMenu = true) {
    selectedAgent = agent;
    stateStore.setSelectedAgent(selectedAgent);
    renderAgentOptions();
    renderControls();
    renderStatus();
    if (closeMenu) {
      setAgentMenuOpen(false);
    }
  }

  function resetCurrentSession() {
    const wasInSession = activeSessions.has(selectedAgent);
    if (wasInSession) {
      activeSessions.delete(selectedAgent);
      stateStore.saveActiveSessions(activeSessions);
      renderControls();
    }
    feedback.flashSessionReset(wasInSession, selectedAgent);
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
    if (hideLauncherWhenIdle) renderControls();
  }

  function renderControls() {
    const hasRunningCue = Boolean(serverState?.activeCue) || inFlightBatches.size > 0;
    const hideLauncher =
      active ||
      (hideLauncherWhenIdle &&
        pins.length === 0 &&
        !hasRunningCue &&
        !feedback.isLauncherDoneActive());
    launcherBtn.classList.toggle("hidden", hideLauncher);
    capsule.classList.toggle("expanded", active);
    pinsLayer.classList.toggle("hidden", markersHidden);

    const picking = active && pickMode;
    pickBtn.classList.toggle("pick-active", picking);
    pickBtn.innerHTML = picking ? ICON_PAUSE : ICON_PICK;
    pickBtn.setAttribute("data-tip", picking ? "Pause Pick · P" : "Resume Pick · P");

    const inSession = activeSessions.has(selectedAgent);
    contBtn.classList.toggle("cont-active", inSession);
    if (!feedback.hasActiveContFeedback()) {
      contBtn.setAttribute(
        "data-tip",
        inSession ? "Reset Session (in session) · R" : "New Session (1st Cue)"
      );
    }
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
    renderHoverElements(
      hoverBox,
      hoverTag,
      el,
      active && pickMode && activePinId === null,
      resolveFrameworkHints
    );
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
    feedback.cancelSendCollapse();
    const changed = next !== active;
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
    if (changed) onActiveChange?.(active);
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
    feedback.flashCopied();
  }

  function restoreFailedBatch(batch: ActivePin[], reason: string, wasFirstInSession = false) {
    feedback.cancelSendCollapse();
    if (wasFirstInSession) {
      activeSessions.delete(selectedAgent);
      stateStore.saveActiveSessions(activeSessions);
    }
    const existingIds = new Set(pins.map((p) => p.id));
    for (const item of batch) {
      if (!existingIds.has(item.id)) pins.push(item);
    }
    setActive(true);
    renderPins();
    feedback.setSendFeedback("error", `Failed · ${reason}`, 3200);
  }

  async function dispatchCue(triggerEvent?: Event) {
    if (requireTrustedSend && !triggerEvent?.isTrusted) return;
    const ready = gatherReadyPins();
    if (ready.length === 0) return;
    if (!connected) {
      feedback.setSendFeedback("error", "Offline · Run npx agentcue or Copy", 2600);
      return;
    }

    feedback.cancelSendCollapse();
    const continueSession = activeSessions.has(selectedAgent);
    const wasFirstInSession = !continueSession;
    activeSessions.add(selectedAgent);
    stateStore.saveActiveSessions(activeSessions);

    const payload = buildCuePayload(selectedAgent, continueSession, ready);
    const snapshot = [...ready];
    pins = [];
    renderPins();
    feedback.setSendFeedback("sent", `Sent ${snapshot.length} → ${selectedAgent} ✓`, 650);
    feedback.scheduleSendCollapse(500, () => setActive(false));

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
        const qMsg = data.queuePosition && data.queuePosition > 1 ? ` (#${data.queuePosition})` : "";
        feedback.setSendTip(`Sent ${snapshot.length} → ${selectedAgent}${qMsg} ✓`);
        renderControls();
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
  sendBtn.addEventListener("click", (e) => void dispatchCue(e));

  popInput.addEventListener("input", () => renderControls());
  popInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      void dispatchCue(e);
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
  popSend.addEventListener("click", (e) => void dispatchCue(e));
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

  const windowCleanups: Array<() => void> = [];
  function onWindow<K extends keyof WindowEventMap>(
    type: K,
    listener: (ev: WindowEventMap[K]) => void,
    opts?: AddEventListenerOptions
  ) {
    window.addEventListener(type, listener as EventListener, opts);
    windowCleanups.push(() =>
      window.removeEventListener(type, listener as EventListener, opts)
    );
  }

  onWindow(
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

  shadow.addEventListener("pointerdown", (e) => {
    if (
      agentMenuOpen &&
      !e.composedPath().includes(agentMenu) &&
      !e.composedPath().includes(agentBtn)
    ) {
      setAgentMenuOpen(false);
    }
  });

  for (const evtName of ["pointerdown", "mousedown", "mouseup", "click"] as const) {
    onWindow(
      evtName,
      (e) => {
        if (requireTrustedSend && !e.isTrusted) return;
        if (agentMenuOpen && evtName === "pointerdown" && !isOverlayEvent(e)) {
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
        const newPin = createPinFromPoint(
          mouseEvt.clientX,
          mouseEvt.clientY,
          host,
          resolveFrameworkHints
        );
        if (!newPin) return;
        pins.push(newPin);
        openPopover(newPin.id);
      },
      { capture: true }
    );
  }

  onWindow(
    "keydown",
    (e) =>
      handleOverlayKeydown(e, {
        requireTrustedSend,
        isActive: () => active,
        isPickMode: () => pickMode,
        isAgentMenuOpen: () => agentMenuOpen,
        hasActivePin: () => activePinId !== null,
        hasAnyPins: () => pins.length > 0,
        hasReadyPins: () => pins.some((p) => p.note.trim().length > 0),
        getAgentList,
        setActive,
        setPickMode,
        setAgentMenuOpen,
        cycleAgent,
        selectAgent,
        closePopover,
        resetCurrentSession,
        dispatchCue: (evt) => void dispatchCue(evt),
        copyMarkdown: () => void copyMarkdown(),
        clearAllPins,
        toggleMarkers,
      }),
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
  onWindow("scroll", scheduleReposition, { capture: true, passive: true });
  onWindow("resize", scheduleReposition, { passive: true });

  function connectSSE(): () => void {
    return transport.subscribeEvents({
      onOpen: () => {
        connected = true;
        renderStatus();
      },
      onEvent: (event: ServerEvent) => {
        if (event.type === "state") {
          serverState = event.state;
          if (event.state.agents.length > 0) {
            availableAgents = event.state.agents;
            if (!stateStore.getSelectedAgent() && event.state.defaultAgent) {
              selectedAgent = event.state.defaultAgent;
            }
            renderAgentOptions();
          }
          renderStatus();
        } else if (event.type === "cue:done") {
          if (!inFlightBatches.delete(event.cueId)) {
            earlyCueDones.add(event.cueId);
          }
          feedback.flashLauncherDone(
            `${event.agent} finished in ${(event.durationMs / 1000).toFixed(1)}s ✓`
          );
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
  const unsubscribeEvents = connectSSE();
  if (options?.startActive) {
    setActive(true);
  }

  return {
    togglePickMode: () => setActive(!active),
    setActive,
    isActive: () => active,
    setHideLauncherWhenIdle: (next: boolean) => {
      hideLauncherWhenIdle = next;
      renderControls();
    },
    destroy: () => {
      feedback.dispose();
      unsubscribeEvents();
      for (const cleanup of windowCleanups) cleanup();
      windowCleanups.length = 0;
      const wasActive = active;
      active = false;
      pickMode = false;
      document.documentElement.style.cursor = "";
      host.remove();
      if (wasActive) onActiveChange?.(false);
    },
  };
}
