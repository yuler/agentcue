import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Dispatcher } from "./dispatcher.ts";
import {
  SUPPORTED_AGENTS,
  type AgentId,
  type CuePayload,
  type ServerEvent,
} from "../shared/types.ts";

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Private-Network": "true",
};

export function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    ...CORS_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function readJsonBody(req: IncomingMessage, maxBytes = 512_000): Promise<unknown> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("Payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        resolveBody(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON payload"));
      }
    });
    req.on("error", reject);
  });
}

export function validateCuePayload(
  raw: unknown,
  allowedAgents: AgentId[]
): CuePayload {
  if (!raw || typeof raw !== "object") {
    throw new Error("Cue body must be a JSON object");
  }
  const obj = raw as Record<string, unknown>;
  const agent = obj.agent as AgentId;
  if (!SUPPORTED_AGENTS.includes(agent)) {
    throw new Error(`Unsupported agent "${String(obj.agent)}"`);
  }
  if (allowedAgents.length > 0 && !allowedAgents.includes(agent)) {
    throw new Error(`Agent "${agent}" is not installed on PATH`);
  }
  if (!Array.isArray(obj.pins) || obj.pins.length === 0) {
    throw new Error("Cue must contain at least one Pin");
  }
  for (const pin of obj.pins) {
    if (!pin || typeof pin !== "object") throw new Error("Invalid Pin entry");
    const p = pin as Record<string, unknown>;
    if (typeof p.note !== "string" || !p.note.trim()) {
      throw new Error("Every Pin requires a non-empty note");
    }
    if (!p.context || typeof p.context !== "object") {
      throw new Error("Every Pin requires DOM context");
    }
  }
  return {
    agent,
    continueSession: Boolean(obj.continueSession),
    pageUrl: typeof obj.pageUrl === "string" ? obj.pageUrl : "/",
    pageTitle: typeof obj.pageTitle === "string" ? obj.pageTitle : "",
    pins: obj.pins as CuePayload["pins"],
  };
}

export function resolveClientBundlePath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "client.js"),
    join(here, "..", "dist", "client.js"),
    join(here, "..", "..", "dist", "client.js"),
  ];
  return candidates.find((p) => existsSync(p)) || candidates[0];
}

export type NextFunction = (err?: unknown) => void;

export interface BridgeHandlerOptions {
  dispatcher: Dispatcher;
  basePath?: string;
  clientOrigin: string | (() => string);
  clientScript?: string;
  clientBundlePath?: string;
}

export interface BridgeHandler {
  middleware: (
    req: IncomingMessage,
    res: ServerResponse,
    next?: NextFunction
  ) => void;
  dispose: () => void;
}

export function createBridgeHandler(
  options: BridgeHandlerOptions
): BridgeHandler {
  const prefix = (options.basePath || "").replace(/\/+$/, "");
  const bundlePath = options.clientBundlePath ?? resolveClientBundlePath();
  const activeCleanups = new Set<() => void>();

  async function handleCuePost(req: IncomingMessage, res: ServerResponse) {
    try {
      const rawBody = await readJsonBody(req);
      const state = options.dispatcher.getState();
      const payload = validateCuePayload(rawBody, state.agents);
      const queued = options.dispatcher.enqueue(payload);
      sendJson(res, 202, {
        ok: true,
        cueId: queued.cueId,
        queuePosition: queued.queuePosition,
      });
    } catch (err) {
      sendJson(res, 400, {
        ok: false,
        error: err instanceof Error ? err.message : "Bad request",
      });
    }
  }

  function middleware(
    req: IncomingMessage,
    res: ServerResponse,
    next?: NextFunction
  ) {
    const method = req.method || "GET";
    const urlObj = new URL(
      req.url || "/",
      `http://${req.headers.host || "localhost"}`
    );
    const pathname = urlObj.pathname;

    let subPath = pathname;
    if (prefix) {
      if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) {
        next?.();
        return;
      }
      subPath = pathname.slice(prefix.length) || "/";
    }

    if (method === "OPTIONS") {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    if (method === "GET" && subPath === "/client.js") {
      const origin =
        typeof options.clientOrigin === "function"
          ? options.clientOrigin()
          : options.clientOrigin;
      const scriptBody =
        options.clientScript ??
        (existsSync(bundlePath)
          ? readFileSync(bundlePath, "utf-8")
          : "console.error('[agentcue] dist/client.js not built yet.');");
      const injected = `window.__AGENTCUE_ORIGIN__=${JSON.stringify(origin)};\n${scriptBody}`;
      res.writeHead(200, {
        ...CORS_HEADERS,
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(injected);
      return;
    }

    if (method === "GET" && subPath === "/api/state") {
      sendJson(res, 200, options.dispatcher.getState());
      return;
    }

    if (method === "GET" && subPath === "/api/events") {
      res.writeHead(200, {
        ...CORS_HEADERS,
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        ...(req.httpVersionMajor >= 2 ? {} : { Connection: "keep-alive" }),
      });
      res.flushHeaders?.();

      const writeEvent = (evt: ServerEvent) => {
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify(evt)}\n\n`);
        }
      };
      writeEvent({ type: "state", state: options.dispatcher.getState() });
      const unsubscribe = options.dispatcher.subscribe(writeEvent);
      const heartbeat = setInterval(() => {
        if (!res.writableEnded) {
          res.write(": ping\n\n");
        }
      }, 15_000);
      heartbeat.unref?.();

      let closed = false;
      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        activeCleanups.delete(forceClose);
      };
      const forceClose = () => {
        cleanup();
        if (!res.writableEnded) {
          res.end();
        }
      };

      activeCleanups.add(forceClose);
      req.on("close", cleanup);
      return;
    }

    if (method === "POST" && subPath === "/api/cue") {
      void handleCuePost(req, res);
      return;
    }

    if (prefix) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    if (next) {
      next();
    } else {
      sendJson(res, 404, { error: "Not found" });
    }
  }

  function dispose() {
    for (const closeStream of activeCleanups) {
      closeStream();
    }
    activeCleanups.clear();
  }

  return { middleware, dispose };
}
