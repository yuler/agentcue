import { appendFileSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const pkgPath = "packages/agentcue/package.json";
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const pkgName = pkg.name;
const bump = process.env.INPUT_BUMP || "patch";
const eventName = process.env.GITHUB_EVENT_NAME || "workflow_run";
const dryRun = process.argv.includes("--dry-run");

function writeOutput(skip, version = "") {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `skip=${skip}\nversion=${version}\n`);
  }
}

function parseSemver(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v || "").trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function cmpSemver(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function fmtSemver([maj, min, pat]) {
  return `${maj}.${min}.${pat}`;
}

function bumpSemver([maj, min, pat], kind) {
  if (kind === "major") return [maj + 1, 0, 0];
  if (kind === "minor") return [maj, min + 1, 0];
  return [maj, min, pat + 1];
}

export function isReleasePath(file) {
  return (
    file.startsWith("packages/agentcue/src/") ||
    file.startsWith("packages/agentcue/scripts/") ||
    file === "packages/agentcue/package.json" ||
    /^packages\/agentcue\/tsconfig(\.[^/]+)?\.json$/.test(file) ||
    file === "examples/html/index.html" ||
    file === "README.md" ||
    file === "LICENSE" ||
    file === "logo.svg" ||
    file === "package.json" ||
    file === "bun.lock" ||
    file === "tsconfig.base.json"
  );
}

function getCommitChangedFiles(hash) {
  let hasParent = true;
  try {
    execFileSync("git", ["rev-parse", "--verify", `${hash}^1`], {
      stdio: "ignore",
    });
  } catch {
    hasParent = false;
  }

  const out = hasParent
    ? execFileSync("git", ["diff", "--name-only", `${hash}^1`, hash], {
        encoding: "utf8",
      })
    : execFileSync(
        "git",
        ["diff-tree", "--no-commit-id", "--name-only", "-r", "--root", hash],
        { encoding: "utf8" }
      );

  return out.split("\n").map((s) => s.trim()).filter(Boolean);
}

function hasUnreleasedRelevantChanges() {
  let latestTag = "";
  try {
    latestTag = execFileSync(
      "git",
      ["describe", "--tags", "--abbrev=0", "--match", "v*"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
  } catch {
    return { relevant: true, reason: "no prior v* tag found" };
  }

  const range = `${latestTag}..HEAD`;
  const logOut = execFileSync(
    "git",
    ["log", "--first-parent", "--format=%H%x09%s", range],
    { encoding: "utf8" }
  ).trim();

  if (!logOut) {
    return { relevant: false, reason: `no new commits since ${latestTag}` };
  }

  const changedFiles = new Set();
  for (const line of logOut.split("\n")) {
    const tabIdx = line.indexOf("\t");
    const hash = tabIdx >= 0 ? line.slice(0, tabIdx) : line;
    const subject = tabIdx >= 0 ? line.slice(tabIdx + 1) : "";
    if (subject.includes("[skip release]")) continue;
    for (const file of getCommitChangedFiles(hash)) {
      changedFiles.add(file);
    }
  }

  const matched = [...changedFiles].filter(isReleasePath);
  if (matched.length === 0) {
    return {
      relevant: false,
      reason: `no release-affecting files changed since ${latestTag}`,
    };
  }
  return {
    relevant: true,
    reason: `matched files since ${latestTag}: ${matched.slice(0, 5).join(", ")}`,
  };
}

const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkgName)}`, {
  headers: { Accept: "application/json", "Cache-Control": "no-cache" },
});

const npmVersions = new Set();
let npmLatest = null;

if (res.status === 200) {
  const data = await res.json();
  for (const v of Object.keys(data.versions || {})) {
    const parsed = parseSemver(v);
    if (parsed) {
      npmVersions.add(fmtSemver(parsed));
      if (!npmLatest || cmpSemver(parsed, npmLatest) > 0) npmLatest = parsed;
    }
  }
  const distLatest = parseSemver(data["dist-tags"]?.latest);
  if (distLatest && (!npmLatest || cmpSemver(distLatest, npmLatest) > 0)) {
    npmLatest = distLatest;
  }
} else if (res.status !== 404) {
  throw new Error(`Unexpected HTTP ${res.status} querying npm registry for ${pkgName}`);
}

if (eventName !== "workflow_dispatch") {
  const headTags = execFileSync("git", ["tag", "--points-at", "HEAD"], {
    encoding: "utf8",
  })
    .split("\n")
    .map(parseSemver)
    .filter(Boolean)
    .map(fmtSemver);

  const publishedHeadTag = headTags.find((v) => npmVersions.has(v));
  if (publishedHeadTag) {
    console.log(`HEAD is already published as v${publishedHeadTag}; skipping.`);
    writeOutput("true", publishedHeadTag);
    process.exit(0);
  }

  const scope = hasUnreleasedRelevantChanges();
  if (!scope.relevant) {
    console.log(`Skipping release: ${scope.reason}.`);
    writeOutput("true", "");
    process.exit(0);
  }
  console.log(`Release scope matched (${scope.reason}).`);
}

const gitTags = execFileSync("git", ["tag", "--list", "v*"], {
  encoding: "utf8",
})
  .split("\n")
  .map(parseSemver)
  .filter(Boolean);

let highestReleased = npmLatest;
for (const t of gitTags) {
  if (!highestReleased || cmpSemver(t, highestReleased) > 0) {
    highestReleased = t;
  }
}

// package.json version is a repo placeholder (0.0.0). Real version is
// derived from npm + git tags in CI and stamped only for publish.
const pkgSemver = parseSemver(pkg.version);
const placeholder =
  !pkgSemver || (pkgSemver[0] === 0 && pkgSemver[1] === 0 && pkgSemver[2] === 0);
let targetSemver;
if (!highestReleased) {
  const initialFloor = [0, 0, 1];
  targetSemver =
    !placeholder && cmpSemver(pkgSemver, initialFloor) > 0 ? pkgSemver : initialFloor;
} else {
  const bumped = bumpSemver(highestReleased, bump);
  targetSemver =
    !placeholder && cmpSemver(pkgSemver, bumped) > 0 ? pkgSemver : bumped;
}

const nextVersion = fmtSemver(targetSemver);
if (!dryRun) {
  pkg.version = nextVersion;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  copyFileSync("README.md", "packages/agentcue/README.md");
}

console.log(
  `Resolved release version: ${nextVersion} (previous: ${highestReleased ? fmtSemver(highestReleased) : "none"})${dryRun ? " [dry-run]" : ""}`
);
writeOutput("false", nextVersion);
