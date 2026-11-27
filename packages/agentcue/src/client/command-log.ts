import type { ServerEvent } from "../shared/types.ts";

export const COMMAND_LOG_CSS = `
.cmd-log {
  pointer-events: auto;
  width: min(420px, calc(100vw - 32px));
  display: flex; flex-direction: column;
  background: rgba(22, 22, 26, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.48);
  overflow: hidden;
  color: #e4e4e7;
  font-size: 12px;
}
.cmd-log[hidden] { display: none !important; }
.cmd-log-bar {
  display: flex; align-items: center; gap: 6px;
  width: 100%; border: none; background: transparent; color: inherit;
  padding: 7px 10px; font: inherit; font-size: 12px; text-align: left;
  cursor: pointer;
}
.cmd-log-chevron { flex: 0 0 auto; color: #a1a1aa; width: 12px; }
.cmd-log-summary {
  flex: 1; min-width: 0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.cmd-log.failed .cmd-log-summary { color: #fca5a5; }
.cmd-log.done .cmd-log-summary { color: #86efac; }
.cmd-log-body {
  display: flex; flex-direction: column;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.cmd-log-body[hidden] { display: none !important; }
.cmd-log-pre {
  margin: 0; padding: 8px 10px;
  overflow: auto; max-height: 200px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px; line-height: 1.45; color: #d4d4d8;
  white-space: pre-wrap; word-break: break-word;
}
.cmd-log-copy {
  align-self: flex-end; margin: 0 8px 8px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.06); color: #f4f4f6;
  border-radius: 7px; padding: 3px 8px; font: inherit; font-size: 11px;
  cursor: pointer;
}
.cmd-log-copy:hover { background: rgba(255, 255, 255, 0.12); }
`;

function lastLine(text: string): string {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  return lines[lines.length - 1] ?? "";
}

function must(shadow: ShadowRoot, id: string): HTMLElement {
  const el = shadow.getElementById(id);
  if (!el) throw new Error(`agentcue: missing #${id}`);
  return el;
}

export function attachCommandLog(shadow: ShadowRoot) {
  const root = must(shadow, "cmdLog");
  const bar = must(shadow, "cmdLogToggle") as HTMLButtonElement;
  const chevron = must(shadow, "cmdLogChevron");
  const summary = must(shadow, "cmdLogSummary");
  const body = must(shadow, "cmdLogBody");
  const pre = must(shadow, "cmdLogPre");
  const copyBtn = must(shadow, "cmdLogCopy");

  root.hidden = true;
  body.hidden = true;

  let text = "";
  let cueId: string | null = null;
  let agent = "agent";
  let expanded = false;
  let copiedTimer: ReturnType<typeof setTimeout> | null = null;

  function setExpanded(next: boolean) {
    expanded = next;
    body.hidden = !next;
    bar.setAttribute("aria-expanded", next ? "true" : "false");
    chevron.textContent = next ? "▾" : "▸";
    if (next) pre.scrollTop = pre.scrollHeight;
  }

  function show(status: "running" | "done" | "failed", detail: string) {
    root.hidden = false;
    root.classList.toggle("running", status === "running");
    root.classList.toggle("done", status === "done");
    root.classList.toggle("failed", status === "failed");
    const label = status === "running" ? "running" : status === "done" ? "done" : "failed";
    const line = status === "done" ? detail : lastLine(detail);
    summary.textContent = line ? `${agent} · ${label} · ${line}` : `${agent} · ${label}`;
    pre.textContent = text;
    if (expanded) pre.scrollTop = pre.scrollHeight;
  }

  function begin(nextId: string, nextAgent?: string) {
    if (cueId === nextId) {
      if (nextAgent) agent = nextAgent;
      return;
    }
    cueId = nextId;
    if (nextAgent) agent = nextAgent;
    text = "";
    setExpanded(false);
    root.hidden = true;
    pre.textContent = "";
    summary.textContent = "";
  }

  bar.addEventListener("click", () => setExpanded(!expanded));
  copyBtn.addEventListener("click", () => {
    const mark = (label: string) => {
      copyBtn.textContent = label;
      if (copiedTimer) clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => {
        copiedTimer = null;
        copyBtn.textContent = "Copy";
      }, 1600);
    };
    const write = navigator.clipboard?.writeText(text);
    if (!write) {
      mark("Copy failed");
      return;
    }
    write.then(
      () => mark("Copied"),
      () => mark("Copy failed")
    );
  });

  return {
    onEvent(event: ServerEvent) {
      if (event.type === "state" && event.state.activeCue) {
        begin(event.state.activeCue.cueId, event.state.activeCue.agent);
        return;
      }
      if (event.type === "cue:log") {
        begin(event.cueId);
        if (event.replace !== undefined) text = event.replace;
        else if (event.append) text += event.append;
        if (text.trim()) show("running", text);
        return;
      }
      if (event.type === "cue:done") {
        begin(event.cueId, event.agent);
        if (event.log) text = event.log;
        if (text.trim()) show("done", `${(event.durationMs / 1000).toFixed(1)}s`);
        return;
      }
      if (event.type === "cue:error") {
        begin(event.cueId, event.agent);
        if (event.log) text = event.log;
        else if (!text.trim()) text = event.error;
        show("failed", event.error || text);
      }
    },
    dispose() {
      if (copiedTimer) clearTimeout(copiedTimer);
    },
  };
}
