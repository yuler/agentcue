import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import {
  createDispatcher,
  type AgentExecutor,
  type Dispatcher,
} from "./server/dispatcher.ts";
import {
  createBridgeHandler,
  isAllowedHost,
  resolveClientBundlePath,
  sendJson,
  type BridgeHandler,
} from "./server/handler.ts";
import { SUPPORTED_AGENTS, type AgentId } from "./shared/types.ts";

export type { AgentId, AgentExecutor, Dispatcher };

export interface AgentcueViteOptions {
  /** Enable or disable the plugin in Vite dev server (default: true). */
  enabled?: boolean;
  /** Default selected Agent Target in the browser capsule. */
  defaultAgent?: AgentId;
  /**
   * Workspace directory where the Agent CLI executes edits.
   * Relative paths resolve from Vite's `root` (default: Vite's `root`).
   */
  cwd?: string;
  /** Mount path prefix on the Vite dev server (default: "/__agentcue"). */
  basePath?: string;
  /** Explicit list of enabled Agent Targets (defaults to auto-detecting PATH). */
  agents?: AgentId[];
  /** Custom Agent CLI executor (useful for testing). */
  executor?: AgentExecutor;
  /** Override bundled client overlay script (useful for testing). */
  clientScript?: string;
  /** Suppress the startup line printed beneath Vite's server URLs. */
  quiet?: boolean;
  /** Optional authentication token required for bridge API requests. */
  token?: string;
  /** Additional allowed CORS origins beyond loopback and browser extensions. */
  allowedOrigins?: string[];
  /** Additional allowed Host header values beyond loopback. */
  allowedHosts?: string[];
  /** Explicitly opt in to agent CLI permission/sandbox bypass flags. */
  unsafeSkipPermissions?: boolean;
}

export interface AgentcueHtmlTagDescriptor {
  tag: string;
  attrs?: Record<string, string | boolean | undefined>;
  children?: string;
  injectTo?: "head" | "body" | "head-prepend" | "body-prepend";
}

export interface ViteResolvedConfigLike {
  readonly root: string;
  readonly base: string;
}

export interface ViteDevServerLike {
  readonly config: {
    readonly root: string;
    readonly base: string;
    readonly logger: {
      info(msg: string): void;
    };
  };
  readonly middlewares: {
    use(
      fn: (
        req: IncomingMessage,
        res: ServerResponse,
        next: () => void
      ) => void
    ): unknown;
  };
  readonly httpServer: {
    once(event: "close", listener: () => void): unknown;
  } | null;
  printUrls?: () => void;
}

export interface AgentcueVitePlugin {
  name: string;
  apply: "serve";
  configResolved(config: ViteResolvedConfigLike): void;
  configureServer(server: ViteDevServerLike): void;
  transformIndexHtml(): AgentcueHtmlTagDescriptor[];
  closeBundle(): void;
}

function normalizeMountPath(viteBase: string, rawBasePath: string): string {
  const cleanMount = `/${rawBasePath.replace(/^\/+|\/+$/g, "")}`;
  const trimmedViteBase = viteBase.trim();
  if (
    !trimmedViteBase ||
    trimmedViteBase === "/" ||
    trimmedViteBase.startsWith(".")
  ) {
    return cleanMount;
  }
  const cleanViteBase = `/${trimmedViteBase.replace(/^\/+|\/+$/g, "")}`;
  if (
    cleanMount === cleanViteBase ||
    cleanMount.startsWith(`${cleanViteBase}/`)
  ) {
    return cleanMount;
  }
  return `${cleanViteBase}${cleanMount}`;
}

function isSameOriginRequest(
  req: IncomingMessage,
  allowedHosts?: string[]
): boolean {
  const host = req.headers.host;
  if (!isAllowedHost(host, allowedHosts)) {
    return false;
  }
  const rawOrigin = req.headers.origin;
  const originHeader = Array.isArray(rawOrigin) ? rawOrigin[0] : rawOrigin;
  if (originHeader !== undefined) {
    const trimmed = originHeader.trim().replace(/\/+$/, "");
    if (!trimmed || trimmed === "null") return false;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return false;
      }
      if (parsed.host.toLowerCase() !== host!.trim().toLowerCase()) {
        return false;
      }
    } catch {
      return false;
    }
  }
  const secFetchSite = req.headers["sec-fetch-site"];
  const site = Array.isArray(secFetchSite) ? secFetchSite[0] : secFetchSite;
  if (
    site !== undefined &&
    site !== "same-origin" &&
    site !== "none"
  ) {
    return false;
  }
  return true;
}

export function agentcue(
  options: AgentcueViteOptions = {}
): AgentcueVitePlugin {
  const enabled = options.enabled ?? true;
  const rawBasePath = options.basePath ?? "/__agentcue";
  let resolvedRoot = process.cwd();
  let mountPath = normalizeMountPath("/", rawBasePath);
  let activeBridge: BridgeHandler | null = null;
  const resolveExpectedToken = () =>
    options.token !== undefined
      ? options.token.trim() || undefined
      : process.env.AGENTCUE_TOKEN?.trim() || undefined;

  return {
    name: "vite-plugin-agentcue",
    apply: "serve",

    configResolved(config) {
      resolvedRoot = config.root;
      mountPath = normalizeMountPath(config.base || "/", rawBasePath);
    },

    configureServer(server) {
      if (!enabled) return;

      const root = server.config?.root || resolvedRoot;
      const base = server.config?.base || "/";
      mountPath = normalizeMountPath(base, rawBasePath);
      const cwd = options.cwd ? resolve(root, options.cwd) : resolve(root);

      const dispatcher = createDispatcher({
        cwd,
        agents: options.agents,
        defaultAgent: options.defaultAgent,
        executor: options.executor,
        unsafeSkipPermissions: options.unsafeSkipPermissions,
      });

      activeBridge?.dispose();
      const bridge = createBridgeHandler({
        dispatcher,
        basePath: mountPath,
        clientOrigin: mountPath,
        clientScript: options.clientScript,
        clientBundlePath: resolveClientBundlePath(),
        token: options.token,
        allowedOrigins: options.allowedOrigins,
        allowedHosts: options.allowedHosts,
      });
      activeBridge = bridge;

      server.middlewares.use((req, res, next) => {
        const expectedToken = resolveExpectedToken();
        if (expectedToken) {
          const rawOrigin = req.headers.origin;
          const originHeader = Array.isArray(rawOrigin)
            ? rawOrigin[0]
            : rawOrigin;
          if (!isSameOriginRequest(req, options.allowedHosts)) {
            const rawUrl = req.url || "/";
            const isBridgeSubPath =
              rawUrl === mountPath ||
              rawUrl.startsWith(`${mountPath}/`) ||
              rawUrl.startsWith(`${mountPath}?`);
            if (!isBridgeSubPath && originHeader !== undefined) {
              res.removeHeader?.("Access-Control-Allow-Origin");
              res.removeHeader?.("Access-Control-Allow-Credentials");
              sendJson(res, 403, {
                ok: false,
                error: "Forbidden cross-origin request in token mode",
              });
              return;
            }
          }
        }
        bridge.middleware(req, res, next);
      });

      server.httpServer?.once("close", () => {
        bridge.dispose();
        if (activeBridge === bridge) activeBridge = null;
      });

      if (!options.quiet && typeof server.printUrls === "function") {
        const originalPrintUrls = server.printUrls.bind(server);
        server.printUrls = () => {
          originalPrintUrls();
          const state = dispatcher.getState();
          const agentList = SUPPORTED_AGENTS.map((a) =>
            state.agents.includes(a)
              ? `\x1b[32m✓ ${a}\x1b[0m`
              : `\x1b[90m✗ ${a}\x1b[0m`
          ).join("  ");
          const expectedToken = resolveExpectedToken();
          const tokenNote = expectedToken
            ? ` · token: \x1b[33m?agentcue_token=${expectedToken}\x1b[0m`
            : "";
          server.config.logger.info(
            `  \x1b[36m➜\x1b[0m  \x1b[1magentcue\x1b[0m: press \x1b[1mCmd/Ctrl + Shift + F\x1b[0m in browser · ${agentList}${tokenNote}`
          );
        };
      }
    },

    transformIndexHtml() {
      if (!enabled) return [];
      return [
        {
          tag: "script",
          attrs: {
            src: `${mountPath}/client.js`,
            defer: true,
          },
          injectTo: "body",
        },
      ];
    },

    closeBundle() {
      activeBridge?.dispose();
      activeBridge = null;
    },
  };
}

export default agentcue;
