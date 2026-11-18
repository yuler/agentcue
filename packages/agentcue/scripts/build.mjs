import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  watch,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(pkgRoot, "..", "..");
const distDir = join(pkgRoot, "dist");

function buildAll({ skipTypes = false } = {}) {
  mkdirSync(distDir, { recursive: true });

  execFileSync(
    "bun",
    [
      "build",
      join(pkgRoot, "src/client/index.ts"),
      "--outfile",
      join(distDir, "client.js"),
      "--target",
      "browser",
      "--format",
      "iife",
      "--minify",
    ],
    { stdio: "inherit" }
  );

  execFileSync(
    "bun",
    [
      "build",
      join(pkgRoot, "src/index.ts"),
      "--outfile",
      join(distDir, "index.js"),
      "--target",
      "node",
      "--format",
      "esm",
    ],
    { stdio: "inherit" }
  );

  execFileSync(
    "bun",
    [
      "build",
      join(pkgRoot, "src/vite.ts"),
      "--outfile",
      join(distDir, "vite.js"),
      "--target",
      "node",
      "--format",
      "esm",
    ],
    { stdio: "inherit" }
  );

  execFileSync(
    "bun",
    [
      "build",
      join(pkgRoot, "src/cli.ts"),
      "--outfile",
      join(distDir, "cli.js"),
      "--target",
      "node",
      "--format",
      "esm",
    ],
    { stdio: "inherit" }
  );

  if (!skipTypes) {
    const tscCandidates = [
      join(pkgRoot, "node_modules", ".bin", "tsc"),
      join(repoRoot, "node_modules", ".bin", "tsc"),
    ];
    const tscBin = tscCandidates.find((p) => existsSync(p));
    if (tscBin) {
      execFileSync(tscBin, ["--project", join(pkgRoot, "tsconfig.build.json")], {
        stdio: "inherit",
      });
    }
  }

  const cliOut = join(distDir, "cli.js");
  const rawCli = readFileSync(cliOut, "utf-8");
  if (!rawCli.startsWith("#!")) {
    writeFileSync(cliOut, `#!/usr/bin/env node\n${rawCli}`);
  }
  chmodSync(cliOut, 0o755);

  const demoSrc = join(repoRoot, "examples", "html", "index.html");
  if (existsSync(demoSrc)) {
    copyFileSync(demoSrc, join(distDir, "demo.html"));
  }

  for (const docFile of ["README.md", "LICENSE"]) {
    const src = join(repoRoot, docFile);
    if (existsSync(src)) {
      copyFileSync(src, join(pkgRoot, docFile));
    }
  }

  console.log(
    "Built dist/client.js, dist/index.js, dist/vite.js, dist/cli.js, and dist/demo.html"
  );
}

const isWatch = process.argv.includes("--watch");
const noInitial = process.argv.includes("--no-initial");

if (!noInitial) {
  buildAll();
}

if (isWatch) {
  console.log("Watching packages/agentcue/src for changes…");
  let timer = null;
  const watcher = watch(join(pkgRoot, "src"), { recursive: true }, (_event, filename) => {
    if (!filename) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        buildAll({ skipTypes: true });
      } catch (err) {
        console.error("[agentcue:dev] rebuild failed:", err);
      }
    }, 80);
  });
  const shutdown = () => {
    clearTimeout(timer);
    watcher.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
