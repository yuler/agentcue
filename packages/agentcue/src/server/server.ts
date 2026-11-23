// Core bridge HTTP/SSE middleware lives in ./handler.ts
import { createServer } from "node:http";
import { resolve } from "node:path";
import {
  createDispatcher,
  type AgentExecutor,
  type Dispatcher,
} from "./dispatcher.ts";
import {
  createBridgeHandler,
  parseRequestUrl,
  resolveClientBundlePath,
  sendJson,
} from "./handler.ts";
import { SUPPORTED_AGENTS, type AgentId } from "../shared/types.ts";
import { getAgentcueVersion } from "../shared/version.ts";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderBridgeIndexPage(params: {
  origin: string;
  version: string;
  cwd: string;
  agents: AgentId[];
}): string {
  const { origin, version, cwd, agents } = params;
  const scriptTag = `<script src="${origin}/client.js"></script>`;
  const agentList = SUPPORTED_AGENTS.map((agent) =>
    agents.includes(agent) ? `✓ ${agent}` : `✗ ${agent}`
  ).join("   ");

  const favicon =
    "data:image/svg+xml," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none"><rect width="32" height="32" rx="8" fill="#fff"/><rect x="0.5" y="0.5" width="31" height="31" rx="7.5" stroke="#111110" stroke-opacity="0.12"/><path d="M9.8 12.79A5 5 0 0 1 12.79 9.8M6.04 11.42A9 9 0 0 1 11.42 6.04" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round"/><path d="M14.5 14.5L26 18.8L20.9 20.9L18.8 26Z" fill="#111110" stroke="#111110" stroke-width="1.5" stroke-linejoin="round"/></svg>`
    );

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>agentcue · Bridge</title>
    <link rel="icon" type="image/svg+xml" href="${favicon}" />
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #000; background: #fff; margin: 0; padding: 48px 24px; line-height: 1.6; }
      main { max-width: 640px; margin: 0 auto; }
      h1 { font-size: 20px; font-weight: 600; margin: 0 0 6px; letter-spacing: -0.02em; display: flex; align-items: center; gap: 8px; }
      h1 svg { flex-shrink: 0; }
      h1 small { font-weight: 400; color: #666; font-size: 14px; }
      h2 { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: #666; margin: 24px 0 8px; }
      p { margin: 0 0 20px; color: #444; font-size: 14px; }
      hr { border: 0; border-top: 1px solid #eaeaea; margin: 24px 0; }
      pre, code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
      pre { margin: 0; padding: 10px 12px; border: 1px solid #eaeaea; border-radius: 4px; overflow-x: auto; }
      ul { list-style: none; padding: 0; margin: 0; font-size: 14px; }
      li { padding: 6px 0; border-bottom: 1px solid #f2f2f2; display: flex; justify-content: space-between; gap: 16px; }
      li:last-child { border-bottom: 0; }
      li span { color: #666; }
    </style>
  </head>
  <body>
    <main>
      <h1><svg viewBox="0 0 32 32" width="22" height="22" fill="none" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#fff"/><rect x="0.5" y="0.5" width="31" height="31" rx="7.5" stroke="#111110" stroke-opacity="0.12"/><path d="M9.8 12.79A5 5 0 0 1 12.79 9.8M6.04 11.42A9 9 0 0 1 11.42 6.04" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round"/><path d="M14.5 14.5L26 18.8L20.9 20.9L18.8 26Z" fill="#111110" stroke="#111110" stroke-width="1.5" stroke-linejoin="round"/></svg>agentcue <small>v${escapeHtml(version)}</small></h1>
      <p>Local HTTP/SSE bridge listening on <code>${escapeHtml(origin)}</code>. Connects the browser overlay or extension to your local Agent CLI.</p>
      <hr />
      <h2>Workspace</h2>
      <pre>${escapeHtml(cwd)}</pre>
      <h2>Agents</h2>
      <pre>${escapeHtml(agentList)}</pre>
      <h2>Script Tag</h2>
      <pre>${escapeHtml(scriptTag)}</pre>
      <h2>Endpoints</h2>
      <ul>
        <li><code>GET /client.js</code><span>Browser overlay bundle</span></li>
        <li><code>GET /api/state</code><span>Bridge &amp; queue state</span></li>
        <li><code>GET /api/events</code><span>Live SSE event stream</span></li>
        <li><code>POST /api/cue</code><span>Dispatch Cue to Agent CLI</span></li>
      </ul>
    </main>
  </body>
</html>`;
}

export interface ServerOptions {
  port?: number;
  host?: string;
  cwd?: string;
  defaultAgent?: AgentId;
  agents?: AgentId[];
  executor?: AgentExecutor;
  clientScript?: string;
}

export interface RunningServer {
  port: number;
  host: string;
  origin: string;
  dispatcher: Dispatcher;
  close(): Promise<void>;
}

export async function startServer(
  options: ServerOptions = {}
): Promise<RunningServer> {
  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? 4318;
  const cwd = resolve(options.cwd ?? process.cwd());

  const dispatcher = createDispatcher({
    cwd,
    agents: options.agents,
    defaultAgent: options.defaultAgent,
    executor: options.executor,
  });

  let boundPort = requestedPort;
  const getOrigin = () =>
    `http://${host === "127.0.0.1" ? "localhost" : host}:${boundPort}`;

  const bridge = createBridgeHandler({
    dispatcher,
    basePath: "",
    clientOrigin: getOrigin,
    clientScript: options.clientScript,
    clientBundlePath: resolveClientBundlePath(),
  });

  const server = createServer((req, res) => {
    bridge.middleware(req, res, () => {
      const method = req.method || "GET";
      const urlObj = parseRequestUrl(req);
      if (!urlObj) {
        sendJson(res, 400, { ok: false, error: "Invalid request URL" });
        return;
      }
      if (method === "GET" && (urlObj.pathname === "/" || urlObj.pathname === "/index.html")) {
        const state = dispatcher.getState();
        const html = renderBridgeIndexPage({
          origin: getOrigin(),
          version: getAgentcueVersion(),
          cwd: state.cwd,
          agents: state.agents,
        });
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(html);
        return;
      }

      sendJson(res, 404, { error: "Not found" });
    });
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(requestedPort, host, () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        boundPort = addr.port;
      }
      resolveListen();
    });
  });

  return {
    port: boundPort,
    host,
    origin: getOrigin(),
    dispatcher,
    close: () => {
      bridge.dispose();
      return new Promise<void>((resolveClose, rejectClose) => {
        server.close((err) => (err ? rejectClose(err) : resolveClose()));
      });
    },
  };
}
