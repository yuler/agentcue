import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRepoVersion } from "../../../scripts/resolve-version.mjs";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(webRoot, "../..");
const distDir = join(webRoot, "dist");
const zhDir = join(distDir, "zh");
mkdirSync(zhDir, { recursive: true });

const version = resolveRepoVersion(repoRoot);
const indexHtml = readFileSync(join(webRoot, "index.html"), "utf-8").replace(
  /\{\{VERSION\}\}/g,
  version,
);

// Write index.html and copy styles.css, logo.svg, and CNAME
writeFileSync(join(distDir, "index.html"), indexHtml, "utf-8");
copyFileSync(join(webRoot, "src/styles.css"), join(distDir, "styles.css"));
copyFileSync(join(webRoot, "src/intro.css"), join(distDir, "intro.css"));
copyFileSync(join(webRoot, "../../logo.svg"), join(distDir, "logo.svg"));
writeFileSync(join(distDir, "CNAME"), "agentcue.yuler.dev\n", "utf-8");

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
let html = indexHtml;
html = html.replace('<html lang="en">', '<html lang="zh-CN">');
html = html.replace(/href="\.\/logo\.svg"/g, 'href="../logo.svg"');
html = html.replace(/src="\.\/logo\.svg"/g, 'src="../logo.svg"');
html = html.replace(/href="\.\/styles\.css"/g, 'href="../styles.css"');
html = html.replace(/href="\.\/intro\.css"/g, 'href="../intro.css"');
html = html.replace(/src="\.\/main\.js"/g, 'src="../main.js"');
html = html.replace(/src="\.\/client\.js"/g, 'src="../client.js"');
writeFileSync(join(zhDir, "index.html"), html, "utf-8");

console.log("Built apps/web/dist (index.html, zh/index.html, styles.css, intro.css, main.js, client.js)");
