import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createBridgeHandler,
  createDispatcher,
} from "../packages/agentcue/dist/index.js";
import { resolveRepoVersion } from "../scripts/resolve-version.mjs";

const examplesDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(examplesDir, "..");
const version = resolveRepoVersion(repoRoot);
const htmlPath = join(examplesDir, "html", "index.html");
const viteReactDir = join(examplesDir, "vite-react");
const clientBundlePath = join(repoRoot, "packages", "agentcue", "dist", "client.js");

const startPort = Number(process.env.PORT) || 4320;
const host = "127.0.0.1";

const viteEntry = Bun.resolveSync("vite", viteReactDir);
const { createServer: createViteServer } = await import(
  pathToFileURL(viteEntry).href
);

const htmlDispatcher = createDispatcher({ cwd: repoRoot });
const htmlBridge = createBridgeHandler({
  dispatcher: htmlDispatcher,
  basePath: "/__agentcue",
  clientOrigin: "/__agentcue",
  clientBundlePath,
});

function renderIndexPage() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>agentcue Examples</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Inter", sans-serif; margin: 0; padding: 48px 24px; background: #f8fafc; color: #0f172a; }
      main { max-width: 640px; margin: 0 auto; }
      h1 { font-size: 24px; margin: 0 0 8px; letter-spacing: -0.02em; }
      p { color: #64748b; margin: 0 0 24px; font-size: 14px; }
      ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 12px; }
      a { display: block; padding: 16px 20px; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; text-decoration: none; color: inherit; }
      a:hover { border-color: #2563eb; }
      strong { display: block; font-size: 15px; margin-bottom: 4px; }
      span { font-size: 13px; color: #64748b; }
    </style>
  </head>
  <body>
    <main>
      <h1>✦ agentcue Examples</h1>
      <p>Local playgrounds served from a single dev server.</p>
      <ul>
        <li><a href="/html"><strong>Plain HTML Playground</strong><span>/html — Zero-build HTML page with live reload and injected client.js</span></a></li>
        <li><a href="/vite-react/"><strong>Vite + React Playground</strong><span>/vite-react/ — Vite HMR app using the agentcue/vite plugin</span></a></li>
      </ul>
    </main>
  </body>
</html>`;
}

function renderHtmlExample() {
  const html = readFileSync(htmlPath, "utf-8").replace(/\{\{VERSION\}\}/g, version);
  const injected = `
<script src="/__agentcue/client.js"></script>
<script>
(() => {
  let lastMtime = null;
  setInterval(async () => {
    try {
      const res = await fetch('/api/html-mtime', { cache: 'no-store' });
      const { mtime } = await res.json();
      if (lastMtime !== null && mtime !== lastMtime) location.reload();
      lastMtime = mtime;
    } catch {}
  }, 800);
})();
</script>`;
  return html.includes("</body>")
    ? html.replace("</body>", `${injected}\n</body>`)
    : `${html}\n${injected}`;
}

let viteServer;

const httpServer = createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const { pathname } = url;

  if (pathname === "/vite-react") {
    res.writeHead(302, { Location: "/vite-react/" });
    res.end();
    return;
  }

  if (pathname.startsWith("/vite-react/")) {
    viteServer.middlewares(req, res, () => {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
    });
    return;
  }

  htmlBridge.middleware(req, res, () => {
    if (req.method === "GET" && pathname === "/api/html-mtime") {
      const mtime = existsSync(htmlPath) ? statSync(htmlPath).mtimeMs : 0;
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify({ mtime }));
      return;
    }

    if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(renderIndexPage());
      return;
    }

    if (req.method === "GET" && (pathname === "/html" || pathname === "/html/")) {
      if (!existsSync(htmlPath)) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("HTML example not found.");
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(renderHtmlExample());
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  });
});

viteServer = await createViteServer({
  root: viteReactDir,
  base: "/vite-react/",
  appType: "spa",
  server: {
    middlewareMode: true,
    hmr: { server: httpServer },
  },
});

function listenWithFallback(port) {
  httpServer.once("error", (err) => {
    if (err && err.code === "EADDRINUSE") {
      listenWithFallback(port + 1);
      return;
    }
    throw err;
  });
  httpServer.listen(port, host);
}

httpServer.on("listening", () => {
  const addr = httpServer.address();
  const bound = addr && typeof addr === "object" ? addr.port : startPort;
  const origin = `http://localhost:${bound}`;
  console.log(`  \x1b[36m➜\x1b[0m  \x1b[1mExamples  \x1b[0m \x1b[36m${origin}\x1b[0m`);
  console.log(`                \x1b[90m├─\x1b[0m HTML        ${origin}/html`);
  console.log(`                \x1b[90m└─\x1b[0m Vite React  ${origin}/vite-react/`);
});

listenWithFallback(startPort);

let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  htmlBridge.dispose();
  void viteServer.close().finally(() => {
    httpServer.close(() => process.exit(0));
    httpServer.closeAllConnections?.();
  });
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
