import type { AgentId } from "../shared/types.ts";
import { isTypingInField } from "./dom.ts";

export interface OverlayShortcutContext {
  requireTrustedSend: boolean;
  isActive: () => boolean;
  isPickMode: () => boolean;
  isAgentMenuOpen: () => boolean;
  hasActivePin: () => boolean;
  hasAnyPins: () => boolean;
  hasReadyPins: () => boolean;
  getAgentList: () => AgentId[];
  setActive: (next: boolean) => void;
  setPickMode: (next: boolean) => void;
  setAgentMenuOpen: (open: boolean) => void;
  cycleAgent: (step: number) => void;
  selectAgent: (agent: AgentId, closeMenu: boolean) => void;
  closePopover: (commit: boolean) => void;
  resetCurrentSession: () => void;
  dispatchCue: (e: Event) => void;
  copyMarkdown: () => void;
  clearAllPins: () => void;
  toggleMarkers: () => void;
}

export function handleOverlayKeydown(
  e: KeyboardEvent,
  ctx: OverlayShortcutContext
): void {
  if (ctx.requireTrustedSend && !e.isTrusted) return;
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === "KeyF") {
    e.preventDefault();
    e.stopPropagation();
    ctx.setActive(!ctx.isActive());
    return;
  }
  if (!ctx.isActive()) return;

  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    if (ctx.hasActivePin() || ctx.hasReadyPins()) {
      e.preventDefault();
      e.stopPropagation();
      ctx.dispatchCue(e);
    }
    return;
  }

  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    if (ctx.hasActivePin()) {
      ctx.closePopover(false);
    } else if (ctx.isAgentMenuOpen()) {
      ctx.setAgentMenuOpen(false);
    } else {
      ctx.setActive(false);
    }
    return;
  }

  if (e.metaKey || e.ctrlKey || e.altKey || ctx.hasActivePin() || isTypingInField(e)) {
    return;
  }

  if (e.code === "KeyA") {
    e.preventDefault();
    ctx.setAgentMenuOpen(!ctx.isAgentMenuOpen());
  } else if (ctx.isAgentMenuOpen() && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
    e.preventDefault();
    ctx.cycleAgent(e.key === "ArrowDown" ? 1 : -1);
  } else if (ctx.isAgentMenuOpen() && e.key === "Enter") {
    e.preventDefault();
    ctx.setAgentMenuOpen(false);
  } else if (/^Digit[1-9]$/.test(e.code)) {
    const idx = Number(e.code.slice(5)) - 1;
    const list = ctx.getAgentList();
    if (idx < list.length) {
      e.preventDefault();
      ctx.selectAgent(list[idx], true);
    }
  } else if (e.code === "KeyP") {
    e.preventDefault();
    ctx.setPickMode(!ctx.isPickMode());
  } else if (e.code === "KeyR") {
    e.preventDefault();
    ctx.resetCurrentSession();
  } else if (e.code === "KeyS" && ctx.hasReadyPins()) {
    e.preventDefault();
    ctx.dispatchCue(e);
  } else if (e.code === "KeyC" && ctx.hasReadyPins()) {
    e.preventDefault();
    ctx.copyMarkdown();
  } else if (e.code === "KeyX" && ctx.hasAnyPins()) {
    e.preventDefault();
    ctx.clearAllPins();
  } else if (e.code === "KeyH" && ctx.hasAnyPins()) {
    e.preventDefault();
    ctx.toggleMarkers();
  }
}
