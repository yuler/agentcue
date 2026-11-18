import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "../../agentcue/src/server/server.ts";
import type { AgentInvocation } from "../../agentcue/src/server/dispatcher.ts";
import type { CuePayload, ServerEvent } from "../../agentcue/src/shared/types.ts";
import {
  consumeSseResponse,
  DEFAULT_BRIDGE_ORIGIN,
  fetchBridgeState,
  isInjectableTabUrl,
  isLocalhostUrl,
  normalizeBridgeOrigin,
  normalizeSettings,
  sendCueToBridge,
} from "../src/protocol.ts";

const extRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(extRoot, "dist");

const sampleCue: CuePayload = {
  agent: "agy",
  continueSession: false,
  pageUrl: "https://staging.example.com/pricing",
  pageTitle: "Pricing",
  pins: [
    {
      index: 1,
      note: "Tighten card padding to 16px",
      context: {
        tagName: "div",
        selector: "section.pricing > div.card",
        breadcrumb: "body > main > section.pricing > div.card",
        outerHTML: '<div class="card">Pro Plan</div>',
        textExcerpt: "Pro Plan",
        computedStyles: { padding: "24px" },
        boundingBox: { x: 20, y: 40, width: 320, height: 180 },
        sourceHint: "src/components/PricingCard.tsx:18",
      },
    },
  ],
};

describe("@agentcue/extension protocol & helpers", () => {
  it("normalizes bridge origins and extension settings", () => {
    assert.equal(normalizeBridgeOrigin(""), DEFAULT_BRIDGE_ORIGIN);
    assert.equal(normalizeBridgeOrigin("localhost:4399/"), "http://localhost:4399");
    assert.equal(
      normalizeBridgeOrigin("http://127.0.0.1:4318///"),
      "http://127.0.0.1:4318"
    );
    assert.equal(normalizeBridgeOrigin("chrome://extensions"), DEFAULT_BRIDGE_ORIGIN);

    const defaults = normalizeSettings(null);
    assert.equal(defaults.bridgeOrigin, DEFAULT_BRIDGE_ORIGIN);
    assert.equal(defaults.autoMountLocalhost, true);

    const custom = normalizeSettings({
      bridgeOrigin: "127.0.0.1:5000",
      autoMountLocalhost: false,
    });
    assert.equal(custom.bridgeOrigin, "http://127.0.0.1:5000");
    assert.equal(custom.autoMountLocalhost, false);
  });

  it("classifies localhost URLs and injectable tab URLs accurately", () => {
    assert.equal(isLocalhostUrl("http://localhost:5173/dashboard"), true);
    assert.equal(isLocalhostUrl("http://127.0.0.1:4318/demo"), true);
    assert.equal(isLocalhostUrl("http://[::1]:3000/"), true);
    assert.equal(isLocalhostUrl("http://web.localhost:8080/"), true);
    assert.equal(isLocalhostUrl("https://example.com/"), false);
    assert.equal(isLocalhostUrl("chrome://extensions"), false);

    assert.equal(isInjectableTabUrl("https://example.com/app"), true);
    assert.equal(isInjectableTabUrl("http://localhost:3000"), true);
    assert.equal(isInjectableTabUrl("chrome://extensions"), false);
    assert.equal(isInjectableTabUrl("about:blank"), false);
  });

  it("proxies health checks, Cue dispatches, and SSE streams against a live agentcue server", async () => {
    const executed: AgentInvocation[] = [];
    const server = await startServer({
      port: 0,
      cwd: "/tmp/ext-workspace",
      agents: ["agy", "claude"],
      defaultAgent: "agy",
      executor: async (inv) => {
        executed.push(inv);
        return { ok: true, exitCode: 0 };
      },
    });

    try {
      const health = await fetchBridgeState(server.origin);
      assert.equal(health.ok, true);
      assert.equal(health.state?.cwd, "/tmp/ext-workspace");
      assert.deepEqual(health.state?.agents, ["agy", "claude"]);

      const receivedEvents: ServerEvent[] = [];
      const sseAbort = new AbortController();
      const sseRes = await fetch(`${server.origin}/api/events`, {
        signal: sseAbort.signal,
      });
      assert.ok(sseRes.ok && sseRes.body);

      const streamPromise = consumeSseResponse(sseRes.body, (evt) => {
        receivedEvents.push(evt);
        if (evt.type === "cue:done") {
          sseAbort.abort();
        }
      }).catch(() => {
        // expected when aborted after cue:done
      });

      const dispatchRes = await sendCueToBridge(server.origin, sampleCue);
      assert.equal(dispatchRes.ok, true);
      assert.ok(dispatchRes.cueId);

      await streamPromise;

      assert.equal(executed.length, 1);
      assert.equal(executed[0].agent, "agy");
      assert.match(executed[0].prompt, /PricingCard\.tsx:18/);
      assert.ok(receivedEvents.some((e) => e.type === "state"));
      assert.ok(receivedEvents.some((e) => e.type === "cue:done"));
    } finally {
      await server.close();
    }
  });

  it("produces complete MV3 unpacked build artifacts and zip bundle", () => {
    const manifestPath = join(distDir, "manifest.json");
    assert.equal(existsSync(manifestPath), true);

    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
      manifest_version: number;
      background: { service_worker: string };
      content_scripts: Array<{ js: string[] }>;
      options_ui: { page: string };
      icons: Record<string, string>;
    };

    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.background.service_worker, "background.js");
    assert.deepEqual(manifest.content_scripts[0].js, ["content.js"]);
    assert.equal(manifest.options_ui.page, "options.html");

    const requiredFiles = [
      "background.js",
      "content.js",
      "page.js",
      "options.html",
      "options.js",
      "icons/icon-16.png",
      "icons/icon-32.png",
      "icons/icon-48.png",
      "icons/icon-128.png",
      "agentcue-extension.zip",
    ];

    for (const file of requiredFiles) {
      const fullPath = join(distDir, file);
      assert.equal(existsSync(fullPath), true, `Missing dist/${file}`);
      assert.ok(statSync(fullPath).size > 0, `Empty dist/${file}`);
    }
  });
});
