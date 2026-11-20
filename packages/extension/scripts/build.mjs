import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  watch,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";
import { resolveRepoVersion } from "../../../scripts/resolve-version.mjs";

const extRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(extRoot, "..", "..");
const distDir = join(extRoot, "dist");
const distIconsDir = join(distDir, "icons");

function createZipBuffer(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf-8");
    const rawData = entry.data;
    const compressed = deflateRawSync(rawData, { level: 9 });
    const useDeflate = compressed.length < rawData.length;
    const payload = useDeflate ? compressed : rawData;
    const method = useDeflate ? 8 : 0;
    const checksum = crc32(rawData) >>> 0;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0x5972, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(rawData.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, payload);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x5972, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(rawData.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + payload.length;
  }

  const centralSize = centralParts.reduce((sum, b) => sum + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

function bundleEntry(entryFile, outFile, format) {
  execFileSync(
    "bun",
    [
      "build",
      join(extRoot, entryFile),
      "--outfile",
      join(distDir, outFile),
      "--target",
      "browser",
      "--format",
      format,
      "--minify",
    ],
    { stdio: "inherit" }
  );
}

function isValidChromeManifestVersion(version) {
  if (typeof version !== "string") return false;
  const trimmed = version.trim();
  if (!/^\d+(\.\d+){0,3}$/.test(trimmed)) return false;
  const parts = trimmed.split(".").map(Number);
  if (parts.some((n) => n < 0 || n > 65535)) return false;
  return parts.some((n) => n > 0);
}

function resolveManifestVersion(fallbackVersion) {
  return resolveRepoVersion(repoRoot, {
    extraCandidates: [process.env.AGENTCUE_EXTENSION_VERSION],
    fallback: fallbackVersion,
    validate: isValidChromeManifestVersion,
  });
}

function buildAll({ skipTypes = false } = {}) {
  mkdirSync(distIconsDir, { recursive: true });

  bundleEntry("src/background.ts", "background.js", "esm");
  bundleEntry("src/content.ts", "content.js", "iife");
  bundleEntry("src/page.ts", "page.js", "iife");
  bundleEntry("src/popup.ts", "popup.js", "esm");

  if (!skipTypes) {
    const tscCandidates = [
      join(extRoot, "node_modules", ".bin", "tsc"),
      join(repoRoot, "node_modules", ".bin", "tsc"),
    ];
    const tscBin = tscCandidates.find((p) => existsSync(p));
    if (tscBin) {
      execFileSync(tscBin, ["--project", join(extRoot, "tsconfig.json")], {
        stdio: "inherit",
      });
    }
  }

  // Sync a valid non-zero MV3 version (never inherit 0.0.0 placeholder)
  const manifest = JSON.parse(
    readFileSync(join(extRoot, "manifest.json"), "utf-8")
  );
  manifest.version = resolveManifestVersion(manifest.version);
  writeFileSync(
    join(distDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf-8"
  );

  copyFileSync(join(extRoot, "src/popup.html"), join(distDir, "popup.html"));

  const iconFiles = readdirSync(join(extRoot, "icons")).filter((f) =>
    f.endsWith(".png")
  );
  for (const icon of iconFiles) {
    copyFileSync(
      join(extRoot, "icons", icon),
      join(distIconsDir, icon)
    );
  }

  const zipFiles = [
    "manifest.json",
    "background.js",
    "content.js",
    "page.js",
    "popup.html",
    "popup.js",
    ...iconFiles.map((icon) => `icons/${icon}`),
  ];

  const zipEntries = zipFiles.map((relPath) => ({
    name: relPath,
    data: readFileSync(join(distDir, relPath)),
  }));

  const zipBuffer = createZipBuffer(zipEntries);
  writeFileSync(join(distDir, "agentcue-extension.zip"), zipBuffer);

  console.log(
    "Built packages/extension/dist (unpacked MV3 extension + agentcue-extension.zip)"
  );
}

const isWatch = process.argv.includes("--watch");
const noInitial = process.argv.includes("--no-initial");

if (!noInitial) {
  buildAll();
}

if (isWatch) {
  console.log("Watching packages/extension/src for changes…");
  let timer = null;
  const watcher = watch(
    join(extRoot, "src"),
    { recursive: true },
    (_event, filename) => {
      if (!filename) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          buildAll({ skipTypes: true });
        } catch (err) {
          console.error("[extension:dev] rebuild failed:", err);
        }
      }, 80);
    }
  );
  const shutdown = () => {
    clearTimeout(timer);
    watcher.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
