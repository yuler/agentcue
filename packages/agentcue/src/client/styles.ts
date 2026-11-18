export const OVERLAY_CSS = `
:host {
  all: initial;
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  pointer-events: none;
  font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
  font-size: 13px;
  line-height: 1.4;
  color: #f4f4f6;
  -webkit-font-smoothing: antialiased;
}
*, *::before, *::after { box-sizing: border-box; }

.hover-box {
  position: fixed; pointer-events: none;
  border: 1.5px solid #3b82f6; background: rgba(59, 130, 246, 0.08);
  border-radius: 5px;
  opacity: 0; visibility: hidden; transform: scale(0.985);
  transition:
    left 70ms cubic-bezier(0.22, 1, 0.36, 1),
    top 70ms cubic-bezier(0.22, 1, 0.36, 1),
    width 70ms cubic-bezier(0.22, 1, 0.36, 1),
    height 70ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 120ms ease, transform 120ms ease, visibility 0s linear 120ms;
}
.hover-box.visible {
  opacity: 1; visibility: visible; transform: scale(1);
  transition:
    left 70ms cubic-bezier(0.22, 1, 0.36, 1),
    top 70ms cubic-bezier(0.22, 1, 0.36, 1),
    width 70ms cubic-bezier(0.22, 1, 0.36, 1),
    height 70ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 120ms ease, transform 120ms ease, visibility 0s linear 0s;
}
.hover-tag {
  position: fixed; pointer-events: none;
  background: rgba(18, 18, 22, 0.96); color: #e2e8f0;
  border: 1px solid rgba(59, 130, 246, 0.42); border-radius: 6px;
  padding: 2px 7px; font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: nowrap; max-width: 360px; overflow: hidden; text-overflow: ellipsis;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.38);
  opacity: 0; visibility: hidden; transform: translateY(3px);
  transition: opacity 110ms ease, transform 110ms ease, visibility 0s linear 110ms;
}
.hover-tag.visible {
  opacity: 1; visibility: visible; transform: translateY(0);
  transition: opacity 110ms ease, transform 110ms ease, visibility 0s linear 0s;
}
.hover-tag .hint-source { color: #93c5fd; margin-left: 6px; }

.pins-layer {
  position: fixed; inset: 0; pointer-events: none;
  opacity: 1; visibility: visible;
  transition: opacity 180ms ease, visibility 0s linear 0s;
}
.pins-layer.hidden {
  opacity: 0; visibility: hidden;
  transition: opacity 160ms ease, visibility 0s linear 160ms;
}
.pin-badge {
  position: fixed; width: 24px; height: 24px; margin: -12px 0 0 -12px;
  border-radius: 999px; background: #2563eb; color: #fff; border: 2px solid #fff;
  font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center;
  cursor: pointer; pointer-events: auto; user-select: none;
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.5), 0 1px 3px rgba(0, 0, 0, 0.4);
  animation: pinPopIn 240ms cubic-bezier(0.34, 1.56, 0.64, 1) backwards;
  transition: transform 160ms cubic-bezier(0.22, 1, 0.36, 1), background 140ms ease, opacity 160ms ease, box-shadow 160ms ease;
}
@keyframes pinPopIn {
  0% { opacity: 0; transform: scale(0.25); }
  100% { opacity: 1; transform: scale(1); }
}
.pin-badge:hover { transform: scale(1.14); background: #1d4ed8; }
.pin-badge.active {
  background: #f59e0b; transform: scale(1.1);
  box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.28), 0 4px 12px rgba(0, 0, 0, 0.45);
}
.pin-badge.removing {
  opacity: 0; transform: scale(0.25); pointer-events: none;
}

.popover {
  position: fixed; width: 310px;
  background: rgba(20, 20, 24, 0.97); backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.13); border-radius: 14px;
  padding: 11px; pointer-events: none;
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(0, 0, 0, 0.3);
  display: flex; flex-direction: column; gap: 8px;
  opacity: 0; visibility: hidden;
  transform: translateY(8px) scale(0.9);
  transform-origin: 0px 20px;
  transition:
    opacity 170ms cubic-bezier(0.4, 0, 0.2, 1),
    transform 190ms cubic-bezier(0.4, 0, 0.2, 1),
    left 180ms cubic-bezier(0.22, 1, 0.36, 1),
    top 180ms cubic-bezier(0.22, 1, 0.36, 1),
    visibility 0s linear 190ms;
}
.popover.no-glide {
  transition:
    opacity 170ms cubic-bezier(0.4, 0, 0.2, 1),
    transform 190ms cubic-bezier(0.4, 0, 0.2, 1),
    visibility 0s linear 190ms;
}
.popover.visible {
  opacity: 1; visibility: visible; pointer-events: auto;
  transform: translateY(0) scale(1);
  transition:
    opacity 200ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 240ms cubic-bezier(0.22, 1, 0.36, 1),
    left 180ms cubic-bezier(0.22, 1, 0.36, 1),
    top 180ms cubic-bezier(0.22, 1, 0.36, 1),
    visibility 0s linear 0s;
}
.popover.visible.no-glide {
  transition:
    opacity 200ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 240ms cubic-bezier(0.22, 1, 0.36, 1),
    visibility 0s linear 0s;
}
.popover-header { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.popover-target {
  display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 11px;
  color: #a1a1aa; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.popover-target .num {
  background: rgba(59, 130, 246, 0.22); color: #93c5fd;
  padding: 1px 6px; border-radius: 999px; font-weight: 700; flex-shrink: 0;
}
.popover-target .sel { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.icon-btn {
  background: transparent; border: none; color: #a1a1aa; cursor: pointer;
  padding: 4px 6px; border-radius: 6px; font-size: 11px; display: inline-flex; align-items: center;
  transition: background 120ms ease, color 120ms ease;
}
.icon-btn:hover { background: rgba(255, 255, 255, 0.1); color: #f87171; }
.popover textarea {
  width: 100%; min-height: 58px; max-height: 140px; resize: vertical;
  background: rgba(0, 0, 0, 0.38); border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px; padding: 7px 9px; color: #f4f4f6;
  font-family: inherit; font-size: 12.5px; line-height: 1.45; outline: none;
  transition: border-color 140ms ease, box-shadow 140ms ease;
}
.popover textarea:focus { border-color: #3b82f6; box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.22); }
.popover textarea::placeholder { color: #71717a; }
.popover-footer { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.popover-hints { font-size: 10.5px; color: #71717a; }
.popover-actions { display: flex; align-items: center; gap: 5px; }
.btn-sm {
  border: 1px solid rgba(255, 255, 255, 0.14); background: rgba(255, 255, 255, 0.07);
  color: #e4e4e7; border-radius: 7px; padding: 4px 9px; font-size: 11px; font-weight: 500; cursor: pointer;
  transition: background 120ms ease, transform 100ms ease;
}
.btn-sm:hover { background: rgba(255, 255, 255, 0.14); }
.btn-sm:active { transform: scale(0.96); }
.btn-sm.primary { background: #2563eb; border-color: #3b82f6; color: #fff; }
.btn-sm.primary:hover { background: #1d4ed8; }

.capsule-wrap {
  position: fixed; right: 16px; bottom: 16px;
  display: flex; flex-direction: column; align-items: flex-end; gap: 8px; pointer-events: none;
}
.toast {
  pointer-events: none; max-width: 360px;
  background: rgba(22, 22, 26, 0.96); border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px; padding: 6px 11px; font-size: 11.5px; color: #e4e4e7;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5);
  opacity: 0; visibility: hidden; transform: translateY(6px) scale(0.95);
  transition: opacity 180ms cubic-bezier(0.22, 1, 0.36, 1), transform 180ms cubic-bezier(0.22, 1, 0.36, 1), visibility 0s linear 180ms;
}
.toast.visible {
  pointer-events: auto; opacity: 1; visibility: visible; transform: translateY(0) scale(1);
  transition: opacity 180ms cubic-bezier(0.22, 1, 0.36, 1), transform 180ms cubic-bezier(0.22, 1, 0.36, 1), visibility 0s linear 0s;
}
.toast.error { border-color: rgba(248, 113, 113, 0.5); color: #fecaca; }

.agent-menu {
  pointer-events: none;
  background: rgba(22, 22, 26, 0.97); backdrop-filter: blur(18px);
  border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 12px;
  padding: 5px; min-width: 170px; margin-right: 44px;
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.55);
  display: flex; flex-direction: column; gap: 2px;
  opacity: 0; visibility: hidden;
  transform: translateY(8px) scale(0.92);
  transform-origin: bottom right;
  transition:
    opacity 160ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 190ms cubic-bezier(0.22, 1, 0.36, 1),
    visibility 0s linear 190ms;
}
.agent-menu.visible {
  pointer-events: auto; opacity: 1; visibility: visible;
  transform: translateY(0) scale(1);
  transition:
    opacity 170ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 210ms cubic-bezier(0.22, 1, 0.36, 1),
    visibility 0s linear 0s;
}
.agent-menu-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 3px 8px 4px; font-size: 10px; font-weight: 600; color: #71717a;
  letter-spacing: 0.04em; text-transform: uppercase;
}
.agent-opt {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  width: 100%; border: none; background: transparent; color: #d4d4d8;
  padding: 5px 8px; border-radius: 8px; font-size: 12px; font-weight: 500;
  cursor: pointer; text-align: left;
  transition: background 110ms ease, color 110ms ease;
}
.agent-opt:hover { background: rgba(255, 255, 255, 0.09); color: #fff; }
.agent-opt.selected { background: rgba(59, 130, 246, 0.18); color: #93c5fd; }
.agent-opt-left { display: flex; align-items: center; gap: 6px; }
.agent-opt-dot {
  width: 5px; height: 5px; border-radius: 999px; background: transparent;
}
.agent-opt.selected .agent-opt-dot { background: #60a5fa; }
.agent-opt-kbd {
  font-size: 10px; color: #71717a; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  background: rgba(255, 255, 255, 0.06); padding: 1px 5px; border-radius: 4px;
}

.toolbar-stage {
  position: relative; display: flex; align-items: center; justify-content: flex-end;
  min-height: 42px;
}
.launcher {
  pointer-events: auto; position: absolute; right: 0;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  min-width: 42px; height: 42px; padding: 0 13px;
  background: rgba(22, 22, 26, 0.95); backdrop-filter: blur(18px);
  border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 999px;
  color: #f4f4f6; font-size: 13px; font-weight: 600; cursor: pointer;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.48);
  opacity: 1; visibility: visible; transform: scale(1);
  transform-origin: center;
  transition:
    transform 250ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 180ms ease,
    border-color 140ms ease,
    background 140ms ease,
    visibility 0s linear 0s;
}
.launcher:hover {
  transform: translateY(-1px) scale(1.03);
  background: rgba(30, 30, 36, 0.98);
  border-color: rgba(255, 255, 255, 0.24);
}
.launcher.hidden {
  pointer-events: none; opacity: 0; visibility: hidden;
  transform: scale(0.55);
  transition:
    transform 210ms cubic-bezier(0.4, 0, 0.2, 1),
    opacity 140ms ease,
    visibility 0s linear 210ms;
}
.launcher-text { font-size: 11.5px; font-weight: 500; color: #cbd5e1; white-space: nowrap; }
.launcher-text:empty { display: none; }
.launcher-count {
  position: absolute; top: -4px; right: -3px;
  min-width: 18px; height: 18px; padding: 0 5px;
  border-radius: 999px; background: #2563eb; color: #fff;
  font-size: 10px; font-weight: 700; display: none;
  align-items: center; justify-content: center;
  border: 1.5px solid #16161a;
}
.launcher-count.visible { display: inline-flex; }

.capsule {
  pointer-events: none;
  display: flex; align-items: center; height: 42px; padding: 0 8px;
  background: rgba(22, 22, 26, 0.96); backdrop-filter: blur(18px);
  border: 1px solid rgba(255, 255, 255, 0.11); border-radius: 999px;
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.55), 0 1px 0 rgba(255, 255, 255, 0.05) inset;
  max-width: 42px; opacity: 0; visibility: hidden;
  transform: scaleX(0.6) scaleY(0.82);
  transform-origin: calc(100% - 21px) 50%;
  transition:
    max-width 240ms cubic-bezier(0.4, 0, 0.2, 1),
    transform 220ms cubic-bezier(0.4, 0, 0.2, 1),
    opacity 160ms ease,
    visibility 0s linear 240ms;
}
.capsule.expanded {
  pointer-events: auto;
  max-width: 460px; opacity: 1; visibility: visible;
  transform: scaleX(1) scaleY(1);
  transition:
    max-width 300ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 280ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 180ms ease,
    visibility 0s linear 0s;
}
.capsule-inner {
  display: flex; align-items: center; gap: 3px;
  opacity: 0; transform: translateX(8px) scale(0.95);
  transition: opacity 130ms ease, transform 180ms cubic-bezier(0.4, 0, 0.2, 1);
}
.capsule.expanded .capsule-inner {
  opacity: 1; transform: translateX(0) scale(1);
  transition: opacity 190ms ease 45ms, transform 240ms cubic-bezier(0.22, 1, 0.36, 1) 35ms;
}

.status-dot {
  width: 6px; height: 6px; border-radius: 999px; background: #10b981; flex-shrink: 0;
}
.status-dot.offline { background: #f59e0b; }
.status-dot.running { background: #38bdf8; animation: pulse 1s ease-in-out infinite; }
.status-dot.error { background: #ef4444; }
@keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.45; transform: scale(0.82); } }

.tool-btn {
  position: relative;
  display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  width: 32px; height: 32px; padding: 0;
  border-radius: 999px; border: none; background: transparent;
  color: rgba(244, 244, 246, 0.78); font-size: 12px; font-weight: 500;
  cursor: pointer; user-select: none; flex-shrink: 0;
  transition: background 130ms ease, color 130ms ease, transform 110ms ease, opacity 130ms ease;
}
.tool-btn svg { width: 15px; height: 15px; stroke-width: 1.85; flex-shrink: 0; }
.tool-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  color: #ffffff;
}
.tool-btn:active:not(:disabled) { transform: scale(0.92); }
.tool-btn:disabled { opacity: 0.32; cursor: not-allowed; }
.tool-btn.pick-active {
  color: #60a5fa;
  background: rgba(59, 130, 246, 0.16);
}
.tool-btn.cont-active {
  color: #d8b4fe;
  background: rgba(168, 85, 247, 0.18);
}
.tool-btn.hide-active {
  color: #fbbf24;
  background: rgba(245, 158, 11, 0.16);
}
.tool-btn.copy-btn .icon-copy,
.tool-btn.copy-btn .icon-check {
  transition: transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 150ms ease;
}
.tool-btn.copy-btn .icon-check {
  position: absolute; opacity: 0; transform: scale(0.35) rotate(-20deg);
}
.tool-btn.copy-btn.copied {
  color: #34d399;
  background: rgba(16, 185, 129, 0.16);
}
.tool-btn.copy-btn.copied .icon-copy {
  opacity: 0; transform: scale(0.35) rotate(20deg);
}
.tool-btn.copy-btn.copied .icon-check {
  opacity: 1; transform: scale(1) rotate(0deg);
}
.tool-btn.agent-btn {
  width: auto; padding: 0 9px; gap: 5px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #f4f4f6; font-size: 11.5px; font-weight: 500;
}
.tool-btn.agent-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.18);
}
.tool-btn.agent-btn.menu-open {
  background: rgba(59, 130, 246, 0.18);
  border-color: rgba(96, 165, 250, 0.45);
  color: #93c5fd;
}
.agent-name { max-width: 82px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kbd {
  font-size: 9.5px; opacity: 0.6;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.tool-btn.send-btn {
  width: auto; min-width: 32px; padding: 0 8px;
  background: rgba(16, 185, 129, 0.18);
  color: #34d399; font-weight: 600;
}
.tool-btn.send-btn:not(:disabled) {
  background: #10b981; color: #052e16;
}
.tool-btn.send-btn:hover:not(:disabled) { background: #34d399; }
.send-count {
  font-size: 11px; font-weight: 700; line-height: 1;
}
.send-count:empty { display: none; }

.tool-btn[data-tip]::after {
  content: attr(data-tip);
  position: absolute; bottom: calc(100% + 9px); left: 50%;
  transform: translateX(-50%) translateY(4px) scale(0.95);
  background: rgba(18, 18, 22, 0.96); color: #f4f4f6;
  border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 6px;
  padding: 3px 7px; font-size: 10.5px; font-weight: 500; white-space: nowrap;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.45);
  pointer-events: none; opacity: 0; visibility: hidden;
  transition: opacity 120ms ease, transform 120ms ease, visibility 0s linear 120ms;
}
.tool-btn[data-tip]:hover::after {
  opacity: 1; visibility: visible;
  transform: translateX(-50%) translateY(0) scale(1);
  transition: opacity 120ms ease 80ms, transform 120ms ease 80ms, visibility 0s linear 80ms;
}
.sep { width: 1px; height: 16px; background: rgba(255, 255, 255, 0.12); margin: 0 3px; flex-shrink: 0; }
`;
