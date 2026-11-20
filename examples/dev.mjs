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
const logoPath = join(repoRoot, "logo.svg");
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
    <title>agentcue · Examples</title>
    <link rel="icon" type="image/svg+xml" href="/logo.svg" />
    <style>
      :root {
        --bg: #f8fafc;
        --surface: #ffffff;
        --border: rgba(15, 23, 42, 0.09);
        --border-hover: rgba(37, 99, 235, 0.45);
        --text: #0f172a;
        --muted: #64748b;
        --accent: #2563eb;
        --accent-soft: rgba(37, 99, 235, 0.1);
        --pill-bg: #f1f5f9;
        --logo-bg: #ffffff;
        --logo-border: rgba(17, 17, 16, 0.12);
        --logo-signal: #2563eb;
        --logo-pointer: #111110;
        --shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
        --shadow-hover: 0 8px 24px -8px rgba(37, 99, 235, 0.18);
      }
      * { box-sizing: border-box; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
        margin: 0;
        padding: 56px 24px;
        background: var(--bg);
        color: var(--text);
        -webkit-font-smoothing: antialiased;
      }
      main { max-width: 640px; margin: 0 auto; }
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 12px;
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .logo-mark { flex-shrink: 0; display: block; }
      .logo-bg { fill: var(--logo-bg); }
      .logo-border { stroke: var(--logo-border); }
      .logo-signal { stroke: var(--logo-signal); }
      .logo-pointer { fill: var(--logo-pointer); stroke: var(--logo-pointer); }
      h1 {
        font-size: 20px;
        font-weight: 650;
        margin: 0;
        letter-spacing: -0.02em;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .divider { color: var(--muted); font-weight: 400; opacity: 0.5; }
      .section-label { font-weight: 500; color: var(--muted); }
      .version {
        font-size: 12px;
        font-weight: 600;
        padding: 3px 9px;
        border-radius: 999px;
        background: var(--accent-soft);
        color: var(--accent);
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .subtitle {
        color: var(--muted);
        margin: 0 0 28px;
        font-size: 14px;
        line-height: 1.5;
      }
      .subtitle code {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
        padding: 2px 6px;
        border-radius: 5px;
        background: var(--pill-bg);
        color: var(--text);
      }
      ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 12px; }
      a.card {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 18px 20px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 14px;
        text-decoration: none;
        color: inherit;
        box-shadow: var(--shadow);
        transition: border-color 0.16s ease, box-shadow 0.16s ease, transform 0.16s ease;
      }
      a.card:hover {
        border-color: var(--border-hover);
        box-shadow: var(--shadow-hover);
        transform: translateY(-1px);
      }
      .card-body { min-width: 0; }
      .card-top {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 6px;
      }
      strong { font-size: 15px; font-weight: 600; letter-spacing: -0.01em; }
      .route {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11.5px;
        padding: 2px 7px;
        border-radius: 6px;
        background: var(--pill-bg);
        color: var(--muted);
      }
      .desc {
        display: block;
        font-size: 13.5px;
        color: var(--muted);
        line-height: 1.45;
      }
      .arrow {
        flex-shrink: 0;
        color: var(--muted);
        font-size: 16px;
        transition: transform 0.16s ease, color 0.16s ease;
      }
      a.card:hover .arrow {
        color: var(--accent);
        transform: translateX(3px);
      }
    </style>
  </head>
  <body>
    <main>
      <header class="header">
        <div class="brand">
          <svg class="logo-mark" viewBox="0 0 32 32" width="28" height="28" fill="none" aria-hidden="true">
            <rect class="logo-bg" width="32" height="32" rx="8" />
            <rect class="logo-border" x="0.5" y="0.5" width="31" height="31" rx="7.5" />
            <path class="logo-signal" d="M9.8 12.79A5 5 0 0 1 12.79 9.8M6.04 11.42A9 9 0 0 1 11.42 6.04" stroke-width="2.5" stroke-linecap="round" />
            <path class="logo-pointer" d="M14.5 14.5L26 18.8L20.9 20.9L18.8 26Z" stroke-width="1.5" stroke-linejoin="round" />
          </svg>
          <h1>agentcue <span class="divider">/</span> <span class="section-label">Examples</span></h1>
        </div>
        <span class="version">v${version}</span>
      </header>
      <p class="subtitle">Local playgrounds served from a single dev server. Press <code>Cmd/Ctrl + Shift + F</code> inside any playground to pick elements.</p>
      <ul>
        <li>
          <a class="card" href="/html">
            <div class="card-body">
              <div class="card-top">
                <strong>Plain HTML Playground</strong>
                <span class="route">/html</span>
              </div>
              <span class="desc">Zero-build HTML page with live reload and injected client.js</span>
            </div>
            <span class="arrow" aria-hidden="true">→</span>
          </a>
        </li>
        <li>
          <a class="card" href="/vite-react/">
            <div class="card-body">
              <div class="card-top">
                <strong>Vite + React Playground</strong>
                <span class="route">/vite-react/</span>
              </div>
              <span class="desc">Vite HMR app powered by the agentcue/vite plugin</span>
            </div>
            <span class="arrow" aria-hidden="true">→</span>
          </a>
        </li>
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

    if (req.method === "GET" && pathname === "/logo.svg" && existsSync(logoPath)) {
      res.writeHead(200, {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "no-store",
      });
      res.end(readFileSync(logoPath));
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
