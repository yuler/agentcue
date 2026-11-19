import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const extRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(extRoot, "dist");
const localIconsDir = join(extRoot, "icons-local");
const DEFAULT_PRODUCTION_ZIP_URLS = [
  "https://github.com/yuler/agentcue/releases/latest/download/agentcue-extension.zip",
  "https://agentcue.yuler.dev/agentcue-extension.zip",
];

function resolveInstallDir() {
  if (process.env.AGENTCUE_EXTENSION_INSTALL_DIR) {
    return resolve(process.env.AGENTCUE_EXTENSION_INSTALL_DIR);
  }
  const xdgData = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return join(xdgData, "agentcue", "extension");
}

function extractZipToDir(zipBuf, destDir) {
  let eocdOffset = -1;
  const minOffset = Math.max(0, zipBuf.length - 65557);
  for (let i = zipBuf.length - 22; i >= minOffset; i--) {
    if (zipBuf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error("Invalid zip archive: missing End of Central Directory");
  }

  const entryCount = zipBuf.readUInt16LE(eocdOffset + 10);
  let cdOffset = zipBuf.readUInt32LE(eocdOffset + 16);
  const resolvedDest = resolve(destDir);

  for (let i = 0; i < entryCount; i++) {
    if (zipBuf.readUInt32LE(cdOffset) !== 0x02014b50) {
      throw new Error("Invalid zip archive: corrupt central directory header");
    }
    const method = zipBuf.readUInt16LE(cdOffset + 10);
    const compressedSize = zipBuf.readUInt32LE(cdOffset + 20);
    const nameLen = zipBuf.readUInt16LE(cdOffset + 28);
    const extraLen = zipBuf.readUInt16LE(cdOffset + 30);
    const commentLen = zipBuf.readUInt16LE(cdOffset + 32);
    const localHeaderOffset = zipBuf.readUInt32LE(cdOffset + 42);
    const entryName = zipBuf
      .subarray(cdOffset + 46, cdOffset + 46 + nameLen)
      .toString("utf-8");

    cdOffset += 46 + nameLen + extraLen + commentLen;

    const cleanRel = normalize(entryName).replace(/^[/\\]+/, "");
    const targetPath = resolve(resolvedDest, cleanRel);
    if (
      targetPath !== resolvedDest &&
      !targetPath.startsWith(`${resolvedDest}/`)
    ) {
      throw new Error(`Unsafe zip entry path: ${entryName}`);
    }

    if (entryName.endsWith("/")) {
      mkdirSync(targetPath, { recursive: true });
      continue;
    }

    if (zipBuf.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error(`Invalid local header for ${entryName}`);
    }
    const localNameLen = zipBuf.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = zipBuf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const rawSlice = zipBuf.subarray(dataStart, dataStart + compressedSize);

    let content;
    if (method === 0) {
      content = rawSlice;
    } else if (method === 8) {
      content = inflateRawSync(rawSlice);
    } else {
      throw new Error(`Unsupported zip compression method ${method} for ${entryName}`);
    }

    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content);
  }
}

function syncDirInPlace(srcDir, targetDir) {
  mkdirSync(targetDir, { recursive: true });
  for (const existing of readdirSync(targetDir)) {
    rmSync(join(targetDir, existing), { recursive: true, force: true });
  }
  for (const entry of readdirSync(srcDir)) {
    if (entry.endsWith(".zip")) continue;
    cpSync(join(srcDir, entry), join(targetDir, entry), { recursive: true });
  }
}

function readManifestVersion(dir) {
  const manifestPath = join(dir, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`Missing manifest.json in ${dir}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  return manifest.version || "unknown";
}

function applyLocalBranding(targetDir) {
  const manifestPath = join(targetDir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  manifest.name = "agentcue(local)";
  manifest.short_name = "agentcue(local)";
  manifest.version_name = `${manifest.version} (local)`;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");

  if (existsSync(localIconsDir)) {
    const targetIconsDir = join(targetDir, "icons");
    mkdirSync(targetIconsDir, { recursive: true });
    for (const icon of readdirSync(localIconsDir)) {
      if (!icon.endsWith(".png")) continue;
      cpSync(join(localIconsDir, icon), join(targetIconsDir, icon));
    }
  }
}

async function installLocal(targetDir) {
  const version = readManifestVersion(distDir);
  syncDirInPlace(distDir, targetDir);
  applyLocalBranding(targetDir);
  console.log(`Installed agentcue extension (local v${version}) → ${targetDir}`);
  console.log("Reload the unpacked extension in chrome://extensions to apply changes.");
}

async function installProduction(targetDir) {
  const candidates = process.env.AGENTCUE_EXTENSION_ZIP_URL
    ? [process.env.AGENTCUE_EXTENSION_ZIP_URL]
    : DEFAULT_PRODUCTION_ZIP_URLS;

  let zipBuf = null;
  let lastError = null;
  for (const zipUrl of candidates) {
    console.log(`Downloading production extension from ${zipUrl}…`);
    try {
      const res = await fetch(zipUrl, { redirect: "follow" });
      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status} from ${zipUrl}`);
        continue;
      }
      zipBuf = Buffer.from(await res.arrayBuffer());
      break;
    } catch (err) {
      lastError = err;
    }
  }
  if (!zipBuf) {
    throw lastError || new Error("Failed to download production extension zip");
  }

  const stagingDir = mkdtempSync(join(tmpdir(), "agentcue-ext-prod-"));
  try {
    extractZipToDir(zipBuf, stagingDir);
    const version = readManifestVersion(stagingDir);
    syncDirInPlace(stagingDir, targetDir);
    console.log(
      `Installed agentcue extension (production v${version}) → ${targetDir}`
    );
    console.log("Reload the unpacked extension in chrome://extensions to apply changes.");
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
}

const mode = process.argv[2];
const targetDir = resolveInstallDir();

if (mode === "--local") {
  await installLocal(targetDir);
} else if (mode === "--production") {
  await installProduction(targetDir);
} else {
  console.error("Usage: bun scripts/install.mjs <--local|--production>");
  process.exit(1);
}
