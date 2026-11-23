import type { IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { QueueFullError, type Dispatcher } from "./dispatcher.ts";
import {
  SUPPORTED_AGENTS,
  type AgentId,
  type CuePayload,
  type ServerEvent,
} from "../shared/types.ts";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function normalizeHostToken(value: string): string {
  return value.trim().toLowerCase().replace(/^\[|\]$/g, "");
}

export function isLoopbackHost(
  hostname: string,
  allowedHosts?: string[]
): boolean {
  const lower = hostname.trim().toLowerCase();
  if (LOOPBACK_HOSTS.has(lower)) return true;
  const bare = normalizeHostToken(lower);
  if (LOOPBACK_HOSTS.has(bare)) return true;
  if (allowedHosts && allowedHosts.length > 0) {
    for (const candidate of allowedHosts) {
      if (candidate && normalizeHostToken(candidate) === bare) {
        return true;
      }
    }
  }
  return false;
}

export function isAllowedHost(
  hostHeader: string | undefined,
  allowedHosts?: string[]
): boolean {
  if (!hostHeader) return false;
  const raw = hostHeader.trim();
  if (!raw || /[/?#@\\\s]/.test(raw)) return false;
  if (raw.toLowerCase() === "::1") return true;
  try {
    const parsed = new URL(`http://${raw}`);
    if (
      parsed.username !== "" ||
      parsed.password !== "" ||
      (parsed.pathname !== "/" && parsed.pathname !== "") ||
      parsed.search !== "" ||
      parsed.hash !== ""
    ) {
      return false;
    }
    return isLoopbackHost(parsed.hostname, allowedHosts);
  } catch {
    return false;
  }
}

export function isAllowedOrigin(
  originHeader: string,
  allowedOrigins?: string[],
  allowedHosts?: string[]
): boolean {
  const trimmed = originHeader.trim();
  if (!trimmed || trimmed === "null" || /\s/.test(trimmed)) return false;
  const normalized = trimmed.replace(/\/+$/, "");

  if (allowedOrigins && allowedOrigins.length > 0) {
    for (const candidate of allowedOrigins) {
      if (candidate && candidate.trim().replace(/\/+$/, "") === normalized) {
        return true;
      }
    }
  }

  try {
    const parsed = new URL(trimmed);
    if (
      parsed.username !== "" ||
      parsed.password !== "" ||
      (parsed.pathname !== "/" && parsed.pathname !== "") ||
      parsed.search !== "" ||
      parsed.hash !== ""
    ) {
      return false;
    }

    if (
      parsed.protocol === "chrome-extension:" ||
      parsed.protocol === "moz-extension:"
    ) {
      return (
        Boolean(parsed.hostname) &&
        /^[a-zA-Z0-9_-]+$/.test(parsed.hostname) &&
        normalized === `${parsed.protocol}//${parsed.host}`
      );
    }

    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return (
        normalized === parsed.origin &&
        isLoopbackHost(parsed.hostname, allowedHosts)
      );
    }

    return false;
  } catch {
    return false;
  }
}

export function buildCorsHeaders(origin?: string): Record<string, string> {
  if (!origin) {
    return { Vary: "Origin" };
  }
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Agentcue-Token",
    Vary: "Origin",
  };
}

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  corsHeaders?: Record<string, string>
) {
  res.writeHead(status, {
    ...corsHeaders,
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

export const MAX_PINS = 50;

export function parseRequestUrl(req: IncomingMessage): URL | null {
  try {
    return new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  } catch {
    return null;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function validateCuePayload(
  raw: unknown,
  allowedAgents: AgentId[]
): CuePayload {
  if (!isPlainRecord(raw)) {
    throw new Error("Cue body must be a JSON object");
  }
  const obj = raw;
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
  if (obj.pins.length > MAX_PINS) {
    throw new Error(`Cue cannot contain more than ${MAX_PINS} Pins`);
  }
  for (const pin of obj.pins) {
    if (!isPlainRecord(pin)) throw new Error("Invalid Pin entry");
    const p = pin;
    if (typeof p.note !== "string" || !p.note.trim()) {
      throw new Error("Every Pin requires a non-empty note");
    }
    if (!isPlainRecord(p.context)) {
      throw new Error("Every Pin requires DOM context");
    }
    const ctx = p.context;
    for (const key of [
      "tagName",
      "selector",
      "breadcrumb",
      "textExcerpt",
      "outerHTML",
    ] as const) {
      if (typeof ctx[key] !== "string") {
        throw new Error(`Pin context requires string "${key}"`);
      }
    }
    if (!isPlainRecord(ctx.boundingBox)) {
      throw new Error("Pin context requires a boundingBox object");
    }
    for (const dim of ["x", "y", "width", "height"] as const) {
      const val = ctx.boundingBox[dim];
      if (typeof val !== "number" || !Number.isFinite(val)) {
        throw new Error(`Pin context boundingBox.${dim} must be a finite number`);
      }
    }
    if (!isPlainRecord(ctx.computedStyles)) {
      throw new Error("Pin context requires a computedStyles object");
    }
    for (const [styleKey, styleVal] of Object.entries(ctx.computedStyles)) {
      if (typeof styleVal !== "string") {
        throw new Error(`Pin context computedStyles["${styleKey}"] must be a string`);
      }
    }
    if (ctx.sourceHint !== undefined && typeof ctx.sourceHint !== "string") {
      throw new Error('Pin context "sourceHint" must be a string');
    }
    if (
      ctx.componentStack !== undefined &&
      typeof ctx.componentStack !== "string"
    ) {
      throw new Error('Pin context "componentStack" must be a string');
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
  token?: string;
  allowedOrigins?: string[];
  allowedHosts?: string[];
}

export interface BridgeHandler {
  middleware: (
    req: IncomingMessage,
    res: ServerResponse,
    next?: NextFunction
  ) => void;
  dispose: () => void;
}

function extractRequestToken(
  req: IncomingMessage,
  urlObj: URL
): string | undefined {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string") {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match && match[1].trim()) return match[1].trim();
  }
  const headerToken = req.headers["x-agentcue-token"];
  if (typeof headerToken === "string" && headerToken.trim()) {
    return headerToken.trim();
  }
  const queryToken = urlObj.searchParams.get("token");
  if (queryToken && queryToken.trim()) {
    return queryToken.trim();
  }
  return undefined;
}

function verifyToken(
  provided: string | undefined,
  expected: string
): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided, "utf-8");
  const b = Buffer.from(expected, "utf-8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function createBridgeHandler(
  options: BridgeHandlerOptions
): BridgeHandler {
  const prefix = (options.basePath || "").replace(/\/+$/, "");
  const bundlePath = options.clientBundlePath ?? resolveClientBundlePath();
  const activeCleanups = new Set<() => void>();
  const resolveExpectedToken = () => {
    if (options.token !== undefined) {
      return options.token.trim() || undefined;
    }
    return process.env.AGENTCUE_TOKEN?.trim() || undefined;
  };

  async function handleCuePost(
    req: IncomingMessage,
    res: ServerResponse,
    corsHeaders: Record<string, string>
  ) {
    try {
      const rawBody = await readJsonBody(req);
      const state = options.dispatcher.getState();
      const payload = validateCuePayload(rawBody, state.agents);
      const queued = options.dispatcher.enqueue(payload);
      sendJson(
        res,
        202,
        {
          ok: true,
          cueId: queued.cueId,
          queuePosition: queued.queuePosition,
        },
        corsHeaders
      );
    } catch (err) {
      const status = err instanceof QueueFullError ? 429 : 400;
      sendJson(
        res,
        status,
        {
          ok: false,
          error: err instanceof Error ? err.message : "Bad request",
        },
        corsHeaders
      );
    }
  }

  function middleware(
    req: IncomingMessage,
    res: ServerResponse,
    next?: NextFunction
  ) {
    const method = req.method || "GET";
    const urlObj = parseRequestUrl(req);
    if (!urlObj) {
      sendJson(res, 400, { ok: false, error: "Invalid request URL" });
      return;
    }
    const pathname = urlObj.pathname;

    let subPath = pathname;
    if (prefix) {
      if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) {
        next?.();
        return;
      }
      subPath = pathname.slice(prefix.length) || "/";
    }

    if (!isAllowedHost(req.headers.host, options.allowedHosts)) {
      sendJson(res, 403, { ok: false, error: "Forbidden host" });
      return;
    }

    const rawOrigin = req.headers.origin;
    const originHeader = Array.isArray(rawOrigin) ? rawOrigin[0] : rawOrigin;
    if (
      originHeader !== undefined &&
      !isAllowedOrigin(
        originHeader,
        options.allowedOrigins,
        options.allowedHosts
      )
    ) {
      sendJson(res, 403, { ok: false, error: "Forbidden origin" });
      return;
    }

    const corsHeaders = buildCorsHeaders(originHeader);

    if (method === "OPTIONS") {
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }

    const expectedToken = resolveExpectedToken();

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
      const tokenAssignment = expectedToken
        ? `window.__AGENTCUE_TOKEN__=${JSON.stringify(expectedToken)};\n`
        : "";
      const injected = `window.__AGENTCUE_ORIGIN__=${JSON.stringify(origin)};\n${tokenAssignment}${scriptBody}`;
      res.writeHead(200, {
        ...corsHeaders,
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(injected);
      return;
    }

    const isApiRoute =
      subPath === "/api/state" ||
      subPath === "/api/events" ||
      subPath === "/api/cue";

    if (isApiRoute && expectedToken) {
      const providedToken = extractRequestToken(req, urlObj);
      if (!verifyToken(providedToken, expectedToken)) {
        sendJson(res, 401, { ok: false, error: "Unauthorized" }, corsHeaders);
        return;
      }
    }

    if (method === "GET" && subPath === "/api/state") {
      sendJson(res, 200, options.dispatcher.getState(), corsHeaders);
      return;
    }

    if (method === "GET" && subPath === "/api/events") {
      res.writeHead(200, {
        ...corsHeaders,
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
      void handleCuePost(req, res, corsHeaders);
      return;
    }

    if (prefix) {
      sendJson(res, 404, { error: "Not found" }, corsHeaders);
      return;
    }

    if (next) {
      next();
    } else {
      sendJson(res, 404, { error: "Not found" }, corsHeaders);
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
