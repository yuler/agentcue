import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { connect } from "node:net";
import {
  buildAgentCommand,
  createDispatcher,
  MAX_QUEUE_SIZE,
  QueueFullError,
  type AgentInvocation,
} from "../src/server/dispatcher.ts";
import {
  createBridgeHandler,
  MAX_PINS,
  validateCuePayload,
} from "../src/server/handler.ts";
import { startServer } from "../src/server/server.ts";
import type { CuePayload, ServerEvent } from "../src/shared/types.ts";
import { getAgentcueVersion } from "../src/shared/version.ts";

function rawHttpRequest(options: {
  port: number;
  method?: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<{
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port: options.port,
        method: options.method ?? "GET",
        path: options.path,
        headers: options.headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf-8"),
          });
        });
      }
    );
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

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
  it("omits permission and sandbox bypass flags by default in fresh mode", () => {
    assert.deepEqual(buildAgentCommand("agy", "PROMPT", false), {
      bin: "agy",
      args: ["-p", "PROMPT"],
    });
    assert.deepEqual(buildAgentCommand("claude", "PROMPT", false), {
      bin: "claude",
      args: ["-p", "PROMPT"],
    });
    assert.deepEqual(buildAgentCommand("cursor-agent", "PROMPT", false), {
      bin: "cursor-agent",
      args: ["-p", "PROMPT"],
    });
    assert.deepEqual(buildAgentCommand("codex", "PROMPT", false), {
      bin: "codex",
      args: ["exec", "--skip-git-repo-check", "PROMPT"],
    });
    assert.deepEqual(buildAgentCommand("pi", "PROMPT", false), {
      bin: "pi",
      args: ["-p", "--", "PROMPT"],
    });
  });

  it("adds session continuation flags without unsafe bypass flags by default", () => {
    assert.deepEqual(buildAgentCommand("agy", "NEXT", true), {
      bin: "agy",
      args: ["--continue", "-p", "NEXT"],
    });
    assert.deepEqual(buildAgentCommand("claude", "NEXT", true), {
      bin: "claude",
      args: ["--continue", "-p", "NEXT"],
    });
    assert.deepEqual(buildAgentCommand("cursor-agent", "NEXT", true), {
      bin: "cursor-agent",
      args: ["--continue", "-p", "NEXT"],
    });
    assert.deepEqual(buildAgentCommand("codex", "NEXT", true), {
      bin: "codex",
      args: ["exec", "resume", "--skip-git-repo-check", "--last", "NEXT"],
    });
    assert.deepEqual(buildAgentCommand("pi", "NEXT", true), {
      bin: "pi",
      args: ["--continue", "-p", "--", "NEXT"],
    });
  });

  it("includes permission bypass flags only when unsafeSkipPermissions is explicitly enabled", () => {
    const unsafe = { unsafeSkipPermissions: true };
    assert.deepEqual(buildAgentCommand("agy", "PROMPT", false, unsafe), {
      bin: "agy",
      args: ["--dangerously-skip-permissions", "-p", "PROMPT"],
    });
    assert.deepEqual(buildAgentCommand("claude", "NEXT", true, unsafe), {
      bin: "claude",
      args: ["--dangerously-skip-permissions", "--continue", "-p", "NEXT"],
    });
    assert.deepEqual(buildAgentCommand("cursor-agent", "PROMPT", false, unsafe), {
      bin: "cursor-agent",
      args: ["--yolo", "-p", "PROMPT"],
    });
    assert.deepEqual(buildAgentCommand("codex", "NEXT", true, unsafe), {
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
    assert.deepEqual(buildAgentCommand("pi", "PROMPT", false, unsafe), {
      bin: "pi",
      args: ["--approve", "-p", "--", "PROMPT"],
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

  it("returns 400 Bad Request on malformed Host header or request URL without crashing", async () => {
    const server = await startServer({
      port: 0,
      agents: ["agy"],
      executor: async () => ({ ok: true, exitCode: 0 }),
    });

    function sendRawHttp(rawRequest: string): Promise<string> {
      return new Promise((resolveRaw, rejectRaw) => {
        const socket = connect(server.port, server.host, () => {
          socket.write(rawRequest);
        });
        let chunks = "";
        socket.setEncoding("utf-8");
        socket.on("data", (chunk) => {
          chunks += chunk;
        });
        socket.on("end", () => resolveRaw(chunks));
        socket.on("error", rejectRaw);
      });
    }

    try {
      // 1. Malformed Host header over TCP socket
      const badHostRaw = await sendRawHttp(
        "GET /api/state HTTP/1.1\r\nHost: bad host:99999\r\nConnection: close\r\n\r\n"
      );
      assert.match(badHostRaw, /^HTTP\/1\.1 400 /);
      assert.match(badHostRaw, /"error":"Invalid request URL"/);

      // 2. Direct middleware call with malformed req.url / Host header
      const dispatcher = createDispatcher({
        cwd: "/tmp/workspace-test",
        agents: ["agy"],
        executor: async () => ({ ok: true, exitCode: 0 }),
      });
      const bridge = createBridgeHandler({
        dispatcher,
        clientOrigin: "http://localhost:4318",
      });

      let status = 0;
      let body = "";
      const fakeReq = {
        method: "GET",
        url: "http://[invalid-ipv6",
        headers: { host: "bad::host" },
      } as unknown as IncomingMessage;
      const fakeRes = {
        writeHead(code: number) {
          status = code;
        },
        end(chunk?: string) {
          body = chunk ?? "";
        },
      } as unknown as ServerResponse;

      bridge.middleware(fakeReq, fakeRes);
      assert.equal(status, 400);
      assert.deepEqual(JSON.parse(body), {
        ok: false,
        error: "Invalid request URL",
      });

      // Server remains alive and responsive after malformed requests
      const healthRes = await fetch(`${server.origin}/api/state`);
      assert.equal(healthRes.status, 200);
    } finally {
      await server.close();
    }
  });

  it("validates PinContext schema fields and caps pins.length in validateCuePayload", () => {
    const valid = sampleCue("agy");
    assert.equal(validateCuePayload(valid, ["agy"]).pins.length, 1);

    // Excessive pins.length
    const tooManyPins = {
      ...valid,
      pins: Array.from({ length: MAX_PINS + 1 }, (_, i) => ({
        ...valid.pins[0],
        index: i + 1,
      })),
    };
    assert.throws(
      () => validateCuePayload(tooManyPins, ["agy"]),
      new RegExp(`more than ${MAX_PINS} Pins`)
    );

    const baseCtx = valid.pins[0].context;
    const withContext = (overrides: Record<string, unknown>) => ({
      ...valid,
      pins: [
        {
          ...valid.pins[0],
          context: { ...baseCtx, ...overrides },
        },
      ],
    });

    // Missing or non-string required string fields
    for (const field of [
      "tagName",
      "selector",
      "breadcrumb",
      "textExcerpt",
      "outerHTML",
    ]) {
      assert.throws(
        () => validateCuePayload(withContext({ [field]: undefined }), ["agy"]),
        new RegExp(`requires string "${field}"`)
      );
      assert.throws(
        () => validateCuePayload(withContext({ [field]: 123 }), ["agy"]),
        new RegExp(`requires string "${field}"`)
      );
    }

    // Malformed boundingBox
    assert.throws(
      () => validateCuePayload(withContext({ boundingBox: null }), ["agy"]),
      /requires a boundingBox object/
    );
    assert.throws(
      () =>
        validateCuePayload(
          withContext({
            boundingBox: { x: "40", y: 20, width: 100, height: 30 },
          }),
          ["agy"]
        ),
      /boundingBox\.x must be a finite number/
    );
    assert.throws(
      () =>
        validateCuePayload(
          withContext({
            boundingBox: { x: Number.NaN, y: 20, width: 100, height: 30 },
          }),
          ["agy"]
        ),
      /boundingBox\.x must be a finite number/
    );

    // Malformed computedStyles
    assert.throws(
      () => validateCuePayload(withContext({ computedStyles: null }), ["agy"]),
      /requires a computedStyles object/
    );
    assert.throws(
      () => validateCuePayload(withContext({ computedStyles: [] }), ["agy"]),
      /requires a computedStyles object/
    );
    assert.throws(
      () =>
        validateCuePayload(
          withContext({ computedStyles: { color: 123 } }),
          ["agy"]
        ),
      /computedStyles\["color"\] must be a string/
    );

    // Optional fields must be strings when present
    assert.throws(
      () => validateCuePayload(withContext({ sourceHint: 42 }), ["agy"]),
      /"sourceHint" must be a string/
    );
    assert.throws(
      () => validateCuePayload(withContext({ componentStack: {} }), ["agy"]),
      /"componentStack" must be a string/
    );
  });

  it("bounds active queue depth in dispatcher and returns HTTP 429 when full", async () => {
    let releaseGate!: () => void;
    const gate = new Promise<void>((r) => {
      releaseGate = r;
    });

    const dispatcher = createDispatcher({
      cwd: "/tmp/workspace-test",
      agents: ["agy"],
      maxQueueSize: 2,
      executor: async () => {
        await gate;
        return { ok: true, exitCode: 0 };
      },
    });

    // First item enters drainQueue immediately (shifts off queue into activeCue)
    dispatcher.enqueue(sampleCue("agy", "Active item"));
    // Next 2 items fill the pending queue up to maxQueueSize = 2
    dispatcher.enqueue(sampleCue("agy", "Queued 1"));
    dispatcher.enqueue(sampleCue("agy", "Queued 2"));

    assert.throws(
      () => dispatcher.enqueue(sampleCue("agy", "Overflow item")),
      QueueFullError
    );

    // Verify HTTP handler returns 429 when dispatcher queue is full
    const bridge = createBridgeHandler({
      dispatcher,
      clientOrigin: "http://localhost:4318",
    });
    const httpServer = createServer((req, res) => bridge.middleware(req, res));
    await new Promise<void>((r) => httpServer.listen(0, "127.0.0.1", r));
    const addr = httpServer.address();
    assert.ok(addr && typeof addr === "object");

    try {
      const res = await fetch(`http://127.0.0.1:${addr.port}/api/cue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sampleCue("agy", "HTTP overflow")),
      });
      assert.equal(res.status, 429);
      const body = (await res.json()) as { ok: boolean; error: string };
      assert.equal(body.ok, false);
      assert.match(body.error, /Cue queue is full/);
    } finally {
      releaseGate();
      bridge.dispose();
      await new Promise<void>((resolve, reject) =>
        httpServer.close((err) => (err ? reject(err) : resolve()))
      );
    }

    assert.equal(MAX_QUEUE_SIZE, 50);
  });

  it("rejects cross-origin requests from external websites with 403 and omits wildcard CORS / PNA headers", async () => {
    const executed: AgentInvocation[] = [];
    const server = await startServer({
      port: 0,
      agents: ["agy"],
      executor: async (inv) => {
        executed.push(inv);
        return { ok: true, exitCode: 0 };
      },
    });

    try {
      const evilOrigin = "https://evil.example.com";

      const preflightRes = await rawHttpRequest({
        port: server.port,
        method: "OPTIONS",
        path: "/api/cue",
        headers: {
          Host: `127.0.0.1:${server.port}`,
          Origin: evilOrigin,
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Private-Network": "true",
        },
      });
      assert.equal(preflightRes.status, 403);
      assert.equal(
        preflightRes.headers["access-control-allow-origin"],
        undefined
      );
      assert.equal(
        preflightRes.headers["access-control-allow-private-network"],
        undefined
      );
      assert.deepEqual(JSON.parse(preflightRes.body), {
        ok: false,
        error: "Forbidden origin",
      });

      const postRes = await rawHttpRequest({
        port: server.port,
        method: "POST",
        path: "/api/cue",
        headers: {
          Host: `127.0.0.1:${server.port}`,
          Origin: evilOrigin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(sampleCue("agy")),
      });
      assert.equal(postRes.status, 403);
      assert.equal(postRes.headers["access-control-allow-origin"], undefined);
      assert.equal(
        postRes.headers["access-control-allow-private-network"],
        undefined
      );
      assert.equal(executed.length, 0);

      const stateRes = await rawHttpRequest({
        port: server.port,
        method: "GET",
        path: "/api/state",
        headers: {
          Host: `127.0.0.1:${server.port}`,
          Origin: evilOrigin,
        },
      });
      assert.equal(stateRes.status, 403);

      const eventsRes = await rawHttpRequest({
        port: server.port,
        method: "GET",
        path: "/api/events",
        headers: {
          Host: `127.0.0.1:${server.port}`,
          Origin: evilOrigin,
        },
      });
      assert.equal(eventsRes.status, 403);
    } finally {
      await server.close();
    }
  });

  it("allows loopback and browser-extension origins with specific CORS echo and blocks DNS rebinding Host headers", async () => {
    const server = await startServer({
      port: 0,
      agents: ["agy"],
      executor: async () => ({ ok: true, exitCode: 0 }),
    });

    try {
      for (const allowedOrigin of [
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://[::1]:4318",
        "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
        "moz-extension://12345678-1234-1234-1234-123456789abc",
      ]) {
        const res = await rawHttpRequest({
          port: server.port,
          method: "GET",
          path: "/api/state",
          headers: {
            Host: `localhost:${server.port}`,
            Origin: allowedOrigin,
          },
        });
        assert.equal(res.status, 200);
        assert.equal(
          res.headers["access-control-allow-origin"],
          allowedOrigin
        );
        assert.equal(
          res.headers["access-control-allow-private-network"],
          undefined
        );
        assert.equal(res.headers["vary"], "Origin");
      }

      for (const badHost of [
        `evil.attacker.com:${server.port}`,
        "evil.attacker.com",
        "localhost.evil.com:4318",
        "127.0.0.1.nip.io:4318",
      ]) {
        const rebindRes = await rawHttpRequest({
          port: server.port,
          method: "POST",
          path: "/api/cue",
          headers: {
            Host: badHost,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(sampleCue("agy")),
        });
        assert.equal(rebindRes.status, 403);
        assert.deepEqual(JSON.parse(rebindRes.body), {
          ok: false,
          error: "Forbidden host",
        });
      }
    } finally {
      await server.close();
    }
  });

  it("enforces token authentication when token is configured and accepts Bearer, X-Agentcue-Token, and query token", async () => {
    const secretToken = "sec-token-1234567890abcdef";
    const server = await startServer({
      port: 0,
      agents: ["agy"],
      token: secretToken,
      clientScript: "/* client */",
      executor: async () => ({ ok: true, exitCode: 0 }),
    });

    try {
      const clientRes = await fetch(`${server.origin}/client.js`);
      assert.equal(clientRes.status, 200);
      const clientBody = await clientRes.text();
      assert.match(
        clientBody,
        new RegExp(`window\\.__AGENTCUE_TOKEN__=${JSON.stringify(secretToken)}`)
      );

      const unauthState = await fetch(`${server.origin}/api/state`);
      assert.equal(unauthState.status, 401);

      const wrongTokenCue = await fetch(`${server.origin}/api/cue`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Agentcue-Token": "wrong-token",
        },
        body: JSON.stringify(sampleCue("agy")),
      });
      assert.equal(wrongTokenCue.status, 401);

      const unauthEvents = await fetch(`${server.origin}/api/events`);
      assert.equal(unauthEvents.status, 401);

      const bearerState = await fetch(`${server.origin}/api/state`, {
        headers: { Authorization: `Bearer ${secretToken}` },
      });
      assert.equal(bearerState.status, 200);

      const headerCue = await fetch(`${server.origin}/api/cue`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Agentcue-Token": secretToken,
        },
        body: JSON.stringify(sampleCue("agy")),
      });
      assert.equal(headerCue.status, 202);

      const sseAbort = new AbortController();
      const queryEvents = await fetch(
        `${server.origin}/api/events?token=${encodeURIComponent(secretToken)}`,
        { signal: sseAbort.signal }
      );
      assert.equal(queryEvents.status, 200);
      sseAbort.abort();
    } finally {
      await server.close();
    }
  });
});
