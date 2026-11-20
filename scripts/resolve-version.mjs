import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Parse a `vX.Y.Z` or `X.Y.Z` semver string into numeric `[major, minor, patch]`.
 */
export function parseSemver(version) {
  if (typeof version !== "string") return null;
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isNonZeroSemver(version) {
  const parsed = parseSemver(version);
  return parsed !== null && (parsed[0] > 0 || parsed[1] > 0 || parsed[2] > 0);
}

export function normalizeVersion(version) {
  return String(version || "").trim().replace(/^v/, "");
}

function cmpSemver(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * Return the highest `v*` git tag version (without leading `v`), or undefined if none exist.
 */
export function readLatestGitTagVersion(repoRoot, validate = isNonZeroSemver) {
  try {
    const out = execFileSync("git", ["tag", "--list", "v*"], {
      cwd: repoRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const candidates = out
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/^v/, "").split("-")[0])
      .filter((candidate) => validate(candidate));

    candidates.sort((a, b) => {
      const pa = parseSemver(a);
      const pb = parseSemver(b);
      if (pa && pb) return cmpSemver(pb, pa);
      return b.localeCompare(a, undefined, { numeric: true });
    });

    return candidates[0];
  } catch {
    return undefined;
  }
}

/**
 * Resolve the canonical release version for build artifacts:
 * 1. Explicit override (extraCandidates / AGENTCUE_VERSION)
 * 2. Stamped packages/agentcue/package.json version (non-0.0.0 during CI publish)
 * 3. Highest `v*` git tag
 * 4. Fallback (default "0.0.1")
 */
export function resolveRepoVersion(repoRoot, options = {}) {
  const validate = options.validate ?? isNonZeroSemver;
  const corePkgPath = join(repoRoot, "packages", "agentcue", "package.json");
  let coreVersion;
  if (existsSync(corePkgPath)) {
    try {
      coreVersion = JSON.parse(readFileSync(corePkgPath, "utf-8")).version;
    } catch {
      coreVersion = undefined;
    }
  }

  const candidates = [
    ...(options.extraCandidates || []),
    process.env.AGENTCUE_VERSION,
    coreVersion,
    readLatestGitTagVersion(repoRoot, validate),
    options.fallback,
    "0.0.1",
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const cleaned = normalizeVersion(candidate);
    if (validate(cleaned)) {
      return cleaned;
    }
  }

  return "0.0.1";
}
