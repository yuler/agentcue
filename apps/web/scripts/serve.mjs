import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync, watch } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const webRoot = join(scriptsDir, "..");
const distDir = join(webRoot, "dist");
const startPort = Number(process.env.PORT) || 4319;
const host = "127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  let relPath = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");

  // Resolve /zh and /zh/ to zh/index.html
  if (relPath === "zh" || relPath === "zh/") {
    relPath = "zh/index.html";
  }

  const filePath = join(distDir, relPath);

  if (!filePath.startsWith(distDir) || !existsSync(filePath)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const ext = extname(filePath);
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  res.end(readFileSync(filePath));
});

server.on("listening", () => {
  const addr = server.address();
  const bound = addr && typeof addr === "object" ? addr.port : startPort;
  console.log(`\n✦ @agentcue/web listening on http://localhost:${bound}\n`);
});

function listenWithFallback(port) {
  server.once("error", (err) => {
    if (err && err.code === "EADDRINUSE") {
      listenWithFallback(port + 1);
      return;
    }
    throw err;
  });
  server.listen(port, host);
}

listenWithFallback(startPort);

const shutdown = () => {
  server.close(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

if (process.argv.includes("--watch")) {
  let timer = null;
  const triggerRebuild = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        execFileSync("node", [join(scriptsDir, "build.mjs")], {
          stdio: "inherit",
        });
      } catch (err) {
        console.error("[web:dev] rebuild failed:", err);
      }
    }, 80);
  };
  watch(join(webRoot, "src"), { recursive: true }, triggerRebuild);
  watch(join(webRoot, "index.html"), triggerRebuild);
}
