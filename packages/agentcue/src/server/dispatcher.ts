import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import {
  createCommandLog,
  failureReason,
  type CommandLogEmit,
} from "./command-log.ts";
import { formatCuePrompt } from "../shared/prompt.ts";
import {
  SUPPORTED_AGENTS,
  type AgentId,
  type CuePayload,
  type DispatcherState,
  type ServerEvent,
} from "../shared/types.ts";

export type { CommandLogEmit };

export interface AgentCommandSpec {
  bin: string;
  args: string[];
}

export interface AgentInvocation {
  cueId: string;
  agent: AgentId;
  continueSession: boolean;
  prompt: string;
  cwd: string;
  command: AgentCommandSpec;
  onLog?: (update: CommandLogEmit) => void;
}

export interface AgentRunResult {
  ok: boolean;
  exitCode: number | null;
  error?: string;
  log?: string;
}

export type AgentExecutor = (
  invocation: AgentInvocation
) => Promise<AgentRunResult>;

export interface BuildAgentCommandOptions {
  /**
   * Pass agent CLI permission/sandbox bypass flags
   * (`--dangerously-skip-permissions`, `--force` (`--yolo` aliases it),
   * `--dangerously-bypass-approvals-and-sandbox`, `--approve`).
   * On by default. Set false to keep each CLI's own prompts (`--safe`).
   */
  unsafeSkipPermissions?: boolean;
}

export function buildAgentCommand(
  agent: AgentId,
  prompt: string,
  continueSession: boolean,
  options?: BuildAgentCommandOptions
): AgentCommandSpec {
  const unsafe = options?.unsafeSkipPermissions !== false;

  switch (agent) {
    case "agy":
      return {
        bin: "agy",
        args: [
          ...(unsafe ? ["--dangerously-skip-permissions"] : []),
          ...(continueSession ? ["--continue"] : []),
          "-p",
          prompt,
        ],
      };

    case "claude":
      return {
        bin: "claude",
        args: [
          ...(unsafe ? ["--dangerously-skip-permissions"] : []),
          ...(continueSession ? ["--continue"] : []),
          "-p",
          prompt,
        ],
      };

    case "cursor-agent":
      return {
        bin: "cursor-agent",
        args: [
          ...(unsafe ? ["--force"] : []),
          ...(continueSession ? ["--continue"] : []),
          "-p",
          prompt,
        ],
      };

    case "codex":
      if (continueSession) {
        return {
          bin: "codex",
          args: [
            "exec",
            "resume",
            ...(unsafe ? ["--dangerously-bypass-approvals-and-sandbox"] : []),
            "--skip-git-repo-check",
            "--last",
            prompt,
          ],
        };
      }
      return {
        bin: "codex",
        args: [
          "exec",
          ...(unsafe ? ["--dangerously-bypass-approvals-and-sandbox"] : []),
          "--skip-git-repo-check",
          prompt,
        ],
      };

    case "pi":
      return {
        bin: "pi",
        args: [
          ...(unsafe ? ["--approve"] : []),
          ...(continueSession ? ["--continue"] : []),
          "-p",
          "--",
          prompt,
        ],
      };
  }
}

export function isBinaryInPath(
  bin: string,
  pathEnv: string = process.env.PATH || ""
): boolean {
  const dirs = pathEnv.split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    const fullPath = join(dir, bin);
    try {
      accessSync(fullPath, constants.X_OK);
      return true;
    } catch {
      // continue scanning PATH
    }
  }
  return false;
}

export function detectAvailableAgents(
  pathEnv: string = process.env.PATH || ""
): AgentId[] {
  return SUPPORTED_AGENTS.filter((agent) => isBinaryInPath(agent, pathEnv));
}

export function createSpawnExecutor(options?: {
  quiet?: boolean;
}): AgentExecutor {
  const quiet = options?.quiet ?? false;

  return (invocation) =>
    new Promise<AgentRunResult>((resolve) => {
      const { bin, args } = invocation.command;
      if (!quiet) {
        console.log(
          `\n\x1b[36m▶ [agentcue]\x1b[0m Running \x1b[1m${invocation.agent}\x1b[0m${invocation.continueSession ? " (continue)" : ""} · cue ${invocation.cueId.slice(0, 8)}`
        );
      }

      const child = spawn(bin, args, {
        cwd: invocation.cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });

      const log = createCommandLog();
      const take = (chunk: Buffer, stream: NodeJS.WriteStream) => {
        if (!quiet) stream.write(chunk);
        const update = log.push(chunk.toString());
        if (update) invocation.onLog?.(update);
      };

      child.stdout?.on("data", (chunk: Buffer) => take(chunk, process.stdout));
      child.stderr?.on("data", (chunk: Buffer) => take(chunk, process.stderr));

      child.on("error", (err) => {
        const error = `Failed to start ${bin}: ${err.message}`;
        resolve({
          ok: false,
          exitCode: null,
          error,
          log: log.text() || error,
        });
      });

      child.on("close", (code) => {
        const transcript = log.text();
        if (code === 0) {
          if (!quiet) {
            console.log(
              `\x1b[32m✓ [agentcue]\x1b[0m ${invocation.agent} finished cue ${invocation.cueId.slice(0, 8)}\n`
            );
          }
          resolve({ ok: true, exitCode: 0, log: transcript });
        } else {
          const reason = failureReason(transcript, bin, code);
          if (!quiet) {
            console.error(
              `\x1b[31m✗ [agentcue]\x1b[0m ${invocation.agent} failed: ${reason}\n`
            );
          }
          resolve({
            ok: false,
            exitCode: code,
            error: reason,
            log: transcript || reason,
          });
        }
      });
    });
}

interface QueuedItem {
  cueId: string;
  payload: CuePayload;
  prompt: string;
}

export const MAX_QUEUE_SIZE = 50;

export class QueueFullError extends Error {
  constructor(maxQueueSize = MAX_QUEUE_SIZE) {
    super(`Cue queue is full (max ${maxQueueSize})`);
    this.name = "QueueFullError";
  }
}

export interface DispatcherOptions {
  cwd: string;
  agents?: AgentId[];
  defaultAgent?: AgentId;
  executor?: AgentExecutor;
  maxQueueSize?: number;
  unsafeSkipPermissions?: boolean;
}

export interface Dispatcher {
  enqueue(payload: CuePayload): { cueId: string; queuePosition: number };
  getState(): DispatcherState;
  subscribe(listener: (event: ServerEvent) => void): () => void;
}

export function createDispatcher(options: DispatcherOptions): Dispatcher {
  const agents = options.agents ?? detectAvailableAgents();
  const preferredDefault =
    options.defaultAgent && agents.includes(options.defaultAgent)
      ? options.defaultAgent
      : (agents[0] ?? options.defaultAgent ?? null);

  const executor = options.executor ?? createSpawnExecutor();
  const maxQueueSize = options.maxQueueSize ?? MAX_QUEUE_SIZE;
  const listeners = new Set<(event: ServerEvent) => void>();
  const queue: QueuedItem[] = [];

  let state: DispatcherState = {
    cwd: options.cwd,
    agents,
    defaultAgent: preferredDefault,
    status: "idle",
    activeCue: null,
    queuedCount: 0,
    lastResult: null,
  };

  let processing = false;

  function emit(event: ServerEvent) {
    for (const listener of listeners) {
      listener(event);
    }
  }

  function emitState() {
    emit({ type: "state", state: getState() });
  }

  function getState(): DispatcherState {
    return {
      ...state,
      agents: [...state.agents],
      activeCue: state.activeCue ? { ...state.activeCue } : null,
      lastResult: state.lastResult ? { ...state.lastResult } : null,
    };
  }

  async function drainQueue() {
    if (processing) return;
    processing = true;

    while (queue.length > 0) {
      const next = queue.shift()!;
      const startedAt = Date.now();

      state = {
        ...state,
        status: "running",
        activeCue: {
          cueId: next.cueId,
          agent: next.payload.agent,
          pinCount: next.payload.pins.length,
          startedAt,
        },
        queuedCount: queue.length,
      };
      emitState();

      const command = buildAgentCommand(
        next.payload.agent,
        next.prompt,
        next.payload.continueSession,
        { unsafeSkipPermissions: options.unsafeSkipPermissions !== false }
      );

      let result: AgentRunResult;
      try {
        result = await executor({
          cueId: next.cueId,
          agent: next.payload.agent,
          continueSession: next.payload.continueSession,
          prompt: next.prompt,
          cwd: options.cwd,
          command,
          onLog: (update) => {
            emit({
              type: "cue:log",
              cueId: next.cueId,
              append: update.append,
              replace: update.replace,
            });
          },
        });
      } catch (err) {
        result = {
          ok: false,
          exitCode: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }

      const finishedAt = Date.now();
      const durationMs = finishedAt - startedAt;

      state = {
        ...state,
        status: queue.length > 0 ? "running" : result.ok ? "done" : "error",
        activeCue: null,
        queuedCount: queue.length,
        lastResult: {
          cueId: next.cueId,
          agent: next.payload.agent,
          ok: result.ok,
          durationMs,
          error: result.error,
          finishedAt,
        },
      };

      const log = result.log ?? "";
      if (result.ok) {
        emit({
          type: "cue:done",
          cueId: next.cueId,
          agent: next.payload.agent,
          durationMs,
          log,
        });
      } else {
        emit({
          type: "cue:error",
          cueId: next.cueId,
          agent: next.payload.agent,
          error: result.error || "Agent command failed",
          log,
        });
      }
      emitState();
    }

    processing = false;
  }

  function enqueue(payload: CuePayload): {
    cueId: string;
    queuePosition: number;
  } {
    if (queue.length >= maxQueueSize) {
      throw new QueueFullError(maxQueueSize);
    }
    const cueId = randomUUID();
    const prompt = formatCuePrompt(payload);
    queue.push({ cueId, payload, prompt });
    const queuePosition = queue.length + (state.activeCue ? 1 : 0);

    state = {
      ...state,
      queuedCount: queue.length,
    };
    emitState();

    void drainQueue();
    return { cueId, queuePosition };
  }

  function subscribe(listener: (event: ServerEvent) => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  return {
    enqueue,
    getState,
    subscribe,
  };
}
