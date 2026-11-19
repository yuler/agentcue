export interface FeedbackElements {
  copyBtn: HTMLButtonElement;
  contBtn: HTMLButtonElement;
  sendBtn: HTMLButtonElement;
  launcherBtn: HTMLButtonElement;
  defaultSendTip: string;
  defaultLauncherTitle: string;
  onRenderControls: () => void;
}

export interface OverlayFeedbackController {
  flashCopied: () => void;
  flashSessionReset: (wasInSession: boolean, agent: string) => void;
  hasActiveContFeedback: () => boolean;
  setSendFeedback: (kind: "sent" | "error", tip: string, ms: number) => void;
  setSendTip: (tip: string) => void;
  clearSendFeedback: () => void;
  scheduleSendCollapse: (delayMs: number, onCollapse: () => void) => void;
  cancelSendCollapse: () => void;
  flashLauncherDone: (summary: string) => void;
  isLauncherDoneActive: () => boolean;
  dispose: () => void;
}

export function createOverlayFeedback(
  el: FeedbackElements
): OverlayFeedbackController {
  let copyTimer: ReturnType<typeof setTimeout> | null = null;
  let contTimer: ReturnType<typeof setTimeout> | null = null;
  let sendFeedbackTimer: ReturnType<typeof setTimeout> | null = null;
  let sendCollapseTimer: ReturnType<typeof setTimeout> | null = null;
  let launcherDoneTimer: ReturnType<typeof setTimeout> | null = null;
  let launcherDoneActive = false;

  const clearSendFeedback = () => {
    if (sendFeedbackTimer) {
      clearTimeout(sendFeedbackTimer);
      sendFeedbackTimer = null;
    }
    el.sendBtn.classList.remove("sent", "error");
    el.sendBtn.setAttribute("data-tip", el.defaultSendTip);
  };

  const cancelSendCollapse = () => {
    if (sendCollapseTimer) {
      clearTimeout(sendCollapseTimer);
      sendCollapseTimer = null;
      clearSendFeedback();
    }
  };

  return {
    flashCopied() {
      if (copyTimer) clearTimeout(copyTimer);
      el.copyBtn.classList.add("copied");
      el.copyBtn.setAttribute("data-tip", "Copied ✓");
      copyTimer = setTimeout(() => {
        copyTimer = null;
        el.copyBtn.classList.remove("copied");
        el.copyBtn.setAttribute("data-tip", "Copy Markdown · C");
      }, 1600);
    },

    flashSessionReset(wasInSession: boolean, agent: string) {
      if (contTimer) clearTimeout(contTimer);
      if (!wasInSession) {
        el.contBtn.setAttribute("data-tip", `Already new session · ${agent}`);
        contTimer = setTimeout(() => {
          contTimer = null;
          el.onRenderControls();
        }, 1600);
        return;
      }
      el.contBtn.classList.add("reset-done");
      el.contBtn.setAttribute("data-tip", "Session reset ✓");
      contTimer = setTimeout(() => {
        contTimer = null;
        el.contBtn.classList.remove("reset-done");
        el.onRenderControls();
      }, 1600);
    },

    hasActiveContFeedback: () => contTimer !== null,

    setSendFeedback(kind, tip, ms) {
      if (sendFeedbackTimer) clearTimeout(sendFeedbackTimer);
      el.sendBtn.classList.remove("sent", "error");
      if (kind === "error") void el.sendBtn.offsetWidth;
      el.sendBtn.classList.add(kind);
      el.sendBtn.setAttribute("data-tip", tip);
      sendFeedbackTimer = setTimeout(() => {
        sendFeedbackTimer = null;
        el.sendBtn.classList.remove("sent", "error");
        el.sendBtn.setAttribute("data-tip", el.defaultSendTip);
      }, ms);
    },

    setSendTip(tip) {
      el.sendBtn.setAttribute("data-tip", tip);
    },

    clearSendFeedback,

    scheduleSendCollapse(delayMs, onCollapse) {
      if (sendCollapseTimer) clearTimeout(sendCollapseTimer);
      sendCollapseTimer = setTimeout(() => {
        sendCollapseTimer = null;
        clearSendFeedback();
        onCollapse();
      }, delayMs);
    },

    cancelSendCollapse,

    flashLauncherDone(summary) {
      if (launcherDoneTimer) clearTimeout(launcherDoneTimer);
      launcherDoneActive = true;
      el.launcherBtn.classList.add("done");
      el.launcherBtn.title = summary;
      el.onRenderControls();
      launcherDoneTimer = setTimeout(() => {
        launcherDoneTimer = null;
        launcherDoneActive = false;
        el.launcherBtn.classList.remove("done");
        el.launcherBtn.title = el.defaultLauncherTitle;
        el.onRenderControls();
      }, 1800);
    },

    isLauncherDoneActive: () => launcherDoneActive,

    dispose() {
      if (copyTimer) clearTimeout(copyTimer);
      if (contTimer) clearTimeout(contTimer);
      if (sendFeedbackTimer) clearTimeout(sendFeedbackTimer);
      if (sendCollapseTimer) clearTimeout(sendCollapseTimer);
      if (launcherDoneTimer) clearTimeout(launcherDoneTimer);
      copyTimer = null;
      contTimer = null;
      sendFeedbackTimer = null;
      sendCollapseTimer = null;
      launcherDoneTimer = null;
      launcherDoneActive = false;
    },
  };
}
