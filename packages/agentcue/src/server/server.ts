// Core bridge HTTP/SSE middleware lives in ./handler.ts
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createDispatcher,
  type AgentExecutor,
  type Dispatcher,
} from "./dispatcher.ts";
import {
  createBridgeHandler,
  resolveClientBundlePath,
  sendJson,
} from "./handler.ts";
import type { AgentId } from "../shared/types.ts";

export interface ServerOptions {
  port?: number;
  host?: string;
  cwd?: string;
  defaultAgent?: AgentId;
  agents?: AgentId[];
  executor?: AgentExecutor;
  clientScript?: string;
  demoHtmlPath?: string;
}

export interface RunningServer {
  port: number;
  host: string;
  origin: string;
  dispatcher: Dispatcher;
  close(): Promise<void>;
}

function resolveDefaultDemoPath(cwd: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidatesDemo = [
    join(cwd, "examples", "html", "index.html"),
    join(here, "..", "..", "examples", "html", "index.html"),
    join(here, "..", "..", "..", "examples", "html", "index.html"),
    join(here, "demo.html"),
    join(here, "..", "dist", "demo.html"),
    join(here, "..", "..", "dist", "demo.html"),
  ];
  return candidatesDemo.find((p) => existsSync(p)) || candidatesDemo[0];
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

  const demoPath = options.demoHtmlPath ?? resolveDefaultDemoPath(cwd);
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
      const urlObj = new URL(
        req.url || "/",
        `http://${req.headers.host || "localhost"}`
      );
      const pathname = urlObj.pathname;

      if (method === "GET" && pathname === "/api/demo-mtime") {
        const mtime = existsSync(demoPath) ? statSync(demoPath).mtimeMs : 0;
        sendJson(res, 200, { mtime });
        return;
      }

      if (method === "GET" && (pathname === "/" || pathname === "/demo")) {
        if (!existsSync(demoPath)) {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Demo page not found.");
          return;
        }
        let html = readFileSync(demoPath, "utf-8");
        const liveReloadAndClient = `
<script src="${getOrigin()}/client.js"></script>
<script>
(() => {
  let last = 0;
  setInterval(async () => {
    try {
      const r = await fetch("/api/demo-mtime", { cache: "no-store" });
      const { mtime } = await r.json();
      if (last && mtime > last) location.reload();
      last = mtime;
    } catch {}
  }, 900);
})();
</script>`;
        html = html.includes("</body>")
          ? html.replace("</body>", `${liveReloadAndClient}\n</body>`)
          : `${html}\n${liveReloadAndClient}`;
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
