import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

declare const __AGENTCUE_VERSION__: string | undefined;

function parseNonZeroSemver(value: unknown): [number, number, number] | null {
  if (typeof value !== "string") return null;
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
  if (!m) return null;
  const parts: [number, number, number] = [
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
  ];
  return parts[0] > 0 || parts[1] > 0 || parts[2] > 0 ? parts : null;
}

let cachedVersion: string | undefined;

/**
 * Resolve the running agentcue version from build-time define, package.json, or git `v*` tags.
 */
export function getAgentcueVersion(): string {
  if (cachedVersion) return cachedVersion;

  if (typeof __AGENTCUE_VERSION__ === "string") {
    const parsed = parseNonZeroSemver(__AGENTCUE_VERSION__);
    if (parsed) {
      cachedVersion = parsed.join(".");
      return cachedVersion;
    }
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const pkgCandidates = [
    join(here, "..", "..", "package.json"),
    join(here, "..", "package.json"),
  ];
  for (const pkgPath of pkgCandidates) {
    if (!existsSync(pkgPath)) continue;
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
        version?: unknown;
      };
      const parsed = parseNonZeroSemver(pkg.version);
      if (parsed) {
        cachedVersion = parsed.join(".");
        return cachedVersion;
      }
    } catch {
      // ignore malformed package.json
    }
  }

  try {
    const out = execFileSync("git", ["tag", "--list", "v*"], {
      cwd: here,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const versions = out
      .split(/\r?\n/)
      .map((line) => parseNonZeroSemver(line.trim().split("-")[0]))
      .filter((v): v is [number, number, number] => v !== null)
      .sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2]);
    if (versions.length > 0) {
      cachedVersion = versions[0].join(".");
      return cachedVersion;
    }
  } catch {
    // git unavailable or not in a repo
  }

  cachedVersion = "0.0.1";
  return cachedVersion;
}
