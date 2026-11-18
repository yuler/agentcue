export const SUPPORTED_AGENTS = [
  "agy",
  "claude",
  "cursor-agent",
  "codex",
  "pi",
] as const;

export type AgentId = (typeof SUPPORTED_AGENTS)[number];

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PinContext {
  tagName: string;
  selector: string;
  breadcrumb: string;
  outerHTML: string;
  textExcerpt: string;
  computedStyles: Record<string, string>;
  boundingBox: BoundingBox;
  sourceHint?: string;
  componentStack?: string;
}

export interface PinPayload {
  index: number;
  note: string;
  context: PinContext;
}

export interface CuePayload {
  agent: AgentId;
  continueSession: boolean;
  pageUrl: string;
  pageTitle: string;
  pins: PinPayload[];
}

export type DispatcherStatus = "idle" | "running" | "done" | "error";

export interface CueSummary {
  cueId: string;
  agent: AgentId;
  pinCount: number;
  startedAt: number;
}

export interface LastCueResult {
  cueId: string;
  agent: AgentId;
  ok: boolean;
  durationMs: number;
  error?: string;
  finishedAt: number;
}

export interface DispatcherState {
  cwd: string;
  agents: AgentId[];
  defaultAgent: AgentId | null;
  status: DispatcherStatus;
  activeCue: CueSummary | null;
  queuedCount: number;
  lastResult: LastCueResult | null;
}

export type ServerEvent =
  | { type: "state"; state: DispatcherState }
  | {
      type: "cue:done";
      cueId: string;
      agent: AgentId;
      durationMs: number;
    }
  | {
      type: "cue:error";
      cueId: string;
      agent: AgentId;
      error: string;
    };
