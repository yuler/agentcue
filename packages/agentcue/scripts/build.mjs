import { execFileSync, spawn } from "node:child_process";
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

function buildAll({ skipTypes = false, clientOnly = false, quiet = false } = {}) {
  mkdirSync(distDir, { recursive: true });
  const stdio = quiet ? ["ignore", "pipe", "pipe"] : "inherit";

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
    { stdio }
  );

  if (clientOnly) {
    if (!quiet) console.log("Built dist/client.js");
    return;
  }

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
    { stdio }
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
    { stdio }
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
    { stdio }
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

  const RAW_BASE = "https://raw.githubusercontent.com/yuler/agentcue/main";
  const BLOB_BASE = "https://github.com/yuler/agentcue/blob/main";

  const readmeSrc = join(repoRoot, "README.md");
  if (existsSync(readmeSrc)) {
    const readme = readFileSync(readmeSrc, "utf-8")
      .replace(/\.\/logo-dark\.svg/g, `${RAW_BASE}/logo-dark.svg`)
      .replace(/\.\/logo\.svg/g, `${RAW_BASE}/logo.svg`)
      .replace(/\(\.\/mise\.toml\)/g, `(${BLOB_BASE}/mise.toml)`);
    writeFileSync(join(pkgRoot, "README.md"), readme);
  }

  for (const docFile of ["LICENSE", "logo.svg", "logo-dark.svg"]) {
    const src = join(repoRoot, docFile);
    if (existsSync(src)) {
      copyFileSync(src, join(pkgRoot, docFile));
    }
  }

  if (!quiet) {
    console.log(
      "Built dist/client.js, dist/index.js, dist/vite.js, dist/cli.js, and dist/demo.html"
    );
  }
}

const isWatch = process.argv.includes("--watch");
const noInitial = process.argv.includes("--no-initial");
const clientOnly = process.argv.includes("--client-only");
const isServe = process.argv.includes("--serve");

if (!noInitial) {
  buildAll({ clientOnly });
}

if (isWatch) {
  let cliChild = null;
  if (isServe) {
    cliChild = spawn(
      "bun",
      ["--watch", join(pkgRoot, "src/cli.ts")],
      {
        cwd: repoRoot,
        stdio: "inherit",
        env: { ...process.env, AGENTCUE_DEV: "1" },
      }
    );
    cliChild.on("exit", (code) => {
      if (code && code !== 0) process.exitCode = code;
    });
  } else {
    console.log(
      "  \x1b[36m➜\x1b[0m  \x1b[1mCLI       \x1b[0m \x1b[90mwatching packages/agentcue/src\x1b[0m"
    );
  }

  let timer = null;
  const watcher = watch(join(pkgRoot, "src"), { recursive: true }, (_event, filename) => {
    if (!filename) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const start = Date.now();
      try {
        buildAll({ skipTypes: true, quiet: true });
        console.log(
          `  \x1b[36m↻\x1b[0m  \x1b[1mCLI       \x1b[0m \x1b[90mrebuilt dist/ (${Date.now() - start}ms)\x1b[0m`
        );
      } catch (err) {
        console.error("[cli:dev] rebuild failed:", err);
      }
    }, 80);
  });
  const shutdown = () => {
    clearTimeout(timer);
    watcher.close();
    if (cliChild && !cliChild.killed) {
      cliChild.kill("SIGTERM");
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
