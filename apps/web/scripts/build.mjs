import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(webRoot, "dist");
const zhDir = join(distDir, "zh");
mkdirSync(zhDir, { recursive: true });

// Copy index.html, styles.css, and logo.svg
copyFileSync(join(webRoot, "index.html"), join(distDir, "index.html"));
copyFileSync(join(webRoot, "src/styles.css"), join(distDir, "styles.css"));
copyFileSync(join(webRoot, "../../logo.svg"), join(distDir, "logo.svg"));

// Copy real compiled client.js from packages/agentcue/dist
const clientSrc = join(webRoot, "../../packages/agentcue/dist/client.js");
copyFileSync(clientSrc, join(distDir, "client.js"));

// Build main.ts → main.js
execFileSync(
  "bun",
  [
    "build",
    join(webRoot, "src/main.ts"),
    "--outfile",
    join(distDir, "main.js"),
    "--target",
    "browser",
    "--format",
    "esm",
    "--minify",
  ],
  { stdio: "inherit" },
);

// Generate zh/index.html with lang="zh-CN" and adjusted asset paths
let html = readFileSync(join(webRoot, "index.html"), "utf-8");
html = html.replace('<html lang="en">', '<html lang="zh-CN">');
html = html.replace(/href="\.\/logo\.svg"/g, 'href="../logo.svg"');
html = html.replace(/src="\.\/logo\.svg"/g, 'src="../logo.svg"');
html = html.replace(/href="\.\/styles\.css"/g, 'href="../styles.css"');
html = html.replace(/src="\.\/main\.js"/g, 'src="../main.js"');
html = html.replace(/src="\.\/client\.js"/g, 'src="../client.js"');
writeFileSync(join(zhDir, "index.html"), html, "utf-8");

console.log("Built apps/web/dist (index.html, zh/index.html, styles.css, main.js, client.js)");
