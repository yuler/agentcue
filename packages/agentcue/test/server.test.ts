import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildAgentCommand,
  type AgentInvocation,
} from "../src/server/dispatcher.ts";
import { startServer } from "../src/server/server.ts";
import type { CuePayload, ServerEvent } from "../src/shared/types.ts";
import { getAgentcueVersion } from "../src/shared/version.ts";

const sampleCue = (
  agent: CuePayload["agent"],
  note = "Make primary button rounded",
  continueSession = false
): CuePayload => ({
  agent,
  continueSession,
  pageUrl: "http://localhost:3000/dashboard?tab=overview",
  pageTitle: "Dashboard",
  pins: [
    {
      index: 1,
      note,
      context: {
        tagName: "button",
        selector: "#primary-cta",
        breadcrumb: "body > main > section.hero > button#primary-cta",
        outerHTML: '<button id="primary-cta" class="btn">Start</button>',
        textExcerpt: "Start",
        computedStyles: {
          "background-color": "rgb(37, 99, 235)",
          "border-radius": "8px",
        },
        boundingBox: { x: 40, y: 220, width: 140, height: 42 },
        sourceHint: "src/components/Hero.tsx:28",
        componentStack: "<App> > <Hero>",
      },
    },
  ],
});

describe("buildAgentCommand across all 5 Agent Targets", () => {
  it("builds non-interactive auto-approve commands in fresh mode", () => {
    assert.deepEqual(buildAgentCommand("agy", "PROMPT", false), {
      bin: "agy",
      args: ["--dangerously-skip-permissions", "-p", "PROMPT"],
    });
    assert.deepEqual(buildAgentCommand("claude", "PROMPT", false), {
      bin: "claude",
      args: ["--dangerously-skip-permissions", "-p", "PROMPT"],
    });
    assert.deepEqual(buildAgentCommand("cursor-agent", "PROMPT", false), {
      bin: "cursor-agent",
      args: ["--yolo", "-p", "PROMPT"],
    });
    assert.deepEqual(buildAgentCommand("codex", "PROMPT", false), {
      bin: "codex",
      args: [
        "exec",
        "--dangerously-bypass-approvals-and-sandbox",
        "--skip-git-repo-check",
        "PROMPT",
      ],
    });
    assert.deepEqual(buildAgentCommand("pi", "PROMPT", false), {
      bin: "pi",
      args: ["--approve", "-p", "--", "PROMPT"],
    });
  });

  it("adds session continuation flags when continueSession is enabled", () => {
    assert.deepEqual(buildAgentCommand("agy", "NEXT", true), {
      bin: "agy",
      args: ["--dangerously-skip-permissions", "--continue", "-p", "NEXT"],
    });
    assert.deepEqual(buildAgentCommand("claude", "NEXT", true), {
      bin: "claude",
      args: ["--dangerously-skip-permissions", "--continue", "-p", "NEXT"],
    });
    assert.deepEqual(buildAgentCommand("cursor-agent", "NEXT", true), {
      bin: "cursor-agent",
      args: ["--yolo", "--continue", "-p", "NEXT"],
    });
    assert.deepEqual(buildAgentCommand("codex", "NEXT", true), {
      bin: "codex",
      args: [
        "exec",
        "resume",
        "--dangerously-bypass-approvals-and-sandbox",
        "--skip-git-repo-check",
        "--last",
        "NEXT",
      ],
    });
    assert.deepEqual(buildAgentCommand("pi", "NEXT", true), {
      bin: "pi",
      args: ["--approve", "--continue", "-p", "--", "NEXT"],
    });
  });
});

describe("Local Bridge HTTP Server & Serial Queue Seam", () => {
  it("executes Cues sequentially in FIFO order and broadcasts SSE lifecycle events", async () => {
    const executed: AgentInvocation[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((r) => {
      releaseFirst = r;
    });

    const server = await startServer({
      port: 0,
      cwd: "/tmp/workspace-test",
      agents: ["agy", "claude", "cursor-agent", "codex"],
      defaultAgent: "agy",
      clientScript: "/* mock client */",
      executor: async (inv) => {
        executed.push(inv);
        if (executed.length === 1) {
          await firstGate;
          return { ok: true, exitCode: 0 };
        }
        return { ok: false, exitCode: 1, error: "simulated failure" };
      },
    });

    try {
      const receivedEvents: ServerEvent[] = [];
      const unsubscribe = server.dispatcher.subscribe((evt) => {
        receivedEvents.push(evt);
      });

      // Verify /client.js injects the server origin
      const clientRes = await fetch(`${server.origin}/client.js`);
      const clientJs = await clientRes.text();
      assert.match(clientJs, new RegExp(server.origin));

      // Enqueue first Cue (agy) and second Cue (claude, continue=true) while first is still running
      const r1 = await fetch(`${server.origin}/api/cue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sampleCue("agy", "Change CTA color", false)),
      });
      assert.equal(r1.status, 202);
      const b1 = (await r1.json()) as { cueId: string; queuePosition: number };

      const r2 = await fetch(`${server.origin}/api/cue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sampleCue("claude", "Make text larger", true)),
      });
      assert.equal(r2.status, 202);
      const b2 = (await r2.json()) as { cueId: string; queuePosition: number };
      assert.equal(b2.queuePosition, 2);

      // Only the first Cue should have started executing while gated
      assert.equal(executed.length, 1);
      assert.equal(executed[0].agent, "agy");
      assert.match(executed[0].prompt, /src\/components\/Hero\.tsx:28/);

      // Release first Cue and wait for queue to drain
      releaseFirst();
      await new Promise((r) => setTimeout(r, 40));

      assert.equal(executed.length, 2);
      assert.equal(executed[1].agent, "claude");
      assert.equal(executed[1].continueSession, true);

      assert.ok(
        receivedEvents.some(
          (e) => e.type === "cue:done" && e.cueId === b1.cueId
        ),
        "Expected cue:done event for first Cue"
      );
      assert.ok(
        receivedEvents.some(
          (e) =>
            e.type === "cue:error" &&
            e.cueId === b2.cueId &&
            e.error === "simulated failure"
        ),
        "Expected cue:error event for second Cue"
      );

      unsubscribe();
    } finally {
      await server.close();
    }
  });

  it("rejects invalid Cue payloads with 400", async () => {
    const server = await startServer({
      port: 0,
      agents: ["agy"],
      executor: async () => ({ ok: true, exitCode: 0 }),
    });
    try {
      const res = await fetch(`${server.origin}/api/cue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: "agy", pins: [] }),
      });
      assert.equal(res.status, 400);
    } finally {
      await server.close();
    }
  });

  it("resolves non-zero version and serves bridge index page at root", async () => {
    const version = getAgentcueVersion();
    assert.match(version, /^\d+\.\d+\.\d+$/);
    assert.notEqual(version, "0.0.0");

    const server = await startServer({
      port: 0,
      agents: ["agy"],
      executor: async () => ({ ok: true, exitCode: 0 }),
    });
    try {
      const res = await fetch(`${server.origin}/`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type") ?? "", /text\/html/);
      const html = await res.text();
      assert.ok(html.includes(`v${version}`));
      assert.ok(html.includes(`${server.origin}/client.js`));
    } finally {
      await server.close();
    }
  });
});
