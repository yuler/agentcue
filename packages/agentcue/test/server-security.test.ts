import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { type AgentInvocation } from "../src/server/dispatcher.ts";
import { startServer } from "../src/server/server.ts";
import type { CuePayload } from "../src/shared/types.ts";

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

describe("Local Bridge CORS, Host, and Token Authentication Hardening (#13)", () => {
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

  it("enforces token authentication when token is configured, never discloses token in /client.js, and accepts Bearer, X-Agentcue-Token, and query token", async () => {
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
      assert.equal(
        clientBody.includes(secretToken),
        false,
        "GET /client.js must never disclose the configured token"
      );
      assert.equal(
        clientBody.includes("__AGENTCUE_TOKEN__"),
        false,
        "GET /client.js must not inject window.__AGENTCUE_TOKEN__"
      );

      const loopbackClientRes = await rawHttpRequest({
        port: server.port,
        method: "GET",
        path: "/client.js",
        headers: {
          Host: `127.0.0.1:${server.port}`,
          Origin: "http://localhost:49999",
        },
      });
      assert.equal(loopbackClientRes.status, 200);
      assert.equal(
        loopbackClientRes.body.includes(secretToken),
        false,
        "Cross-origin loopback GET /client.js must never leak the token"
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
