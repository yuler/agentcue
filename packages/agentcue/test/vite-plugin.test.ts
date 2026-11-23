import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import agentcue, { agentcue as namedAgentcue } from "../src/vite.ts";
import type { AgentInvocation } from "../src/server/dispatcher.ts";
import type { CuePayload } from "../src/shared/types.ts";

const sampleViteCue: CuePayload = {
  agent: "agy",
  continueSession: false,
  pageUrl: "http://localhost:5173/pricing",
  pageTitle: "PulseCloud",
  pins: [
    {
      index: 1,
      note: "Make Pro card border emerald",
      context: {
        tagName: "article",
        selector: 'article[data-testid="plan-pro"]',
        breadcrumb: "body > div.page-shell > section#pricing > article.plan-card",
        outerHTML: '<article data-testid="plan-pro">Pro Team</article>',
        textExcerpt: "Pro Team",
        computedStyles: { "border-radius": "14px" },
        boundingBox: { x: 24, y: 180, width: 300, height: 340 },
        sourceHint: "src/components/PricingSection.tsx:70",
        componentStack: "<App> > <PricingSection> > <PlanCard>",
      },
    },
  ],
};

describe("agentcue/vite plugin", () => {
  it("exports both default and named plugin factory and applies only in serve mode", () => {
    assert.equal(agentcue, namedAgentcue);
    const plugin = agentcue();
    assert.equal(plugin.name, "vite-plugin-agentcue");
    assert.equal(plugin.apply, "serve");

    assert.deepEqual(plugin.transformIndexHtml(), [
      {
        tag: "script",
        attrs: { src: "/__agentcue/client.js", defer: true },
        injectTo: "body",
      },
    ]);
  });

  it("respects Vite base path and enabled: false option", () => {
    const subAppPlugin = agentcue({ basePath: "/__cue" });
    subAppPlugin.configResolved({ root: "/tmp/app", base: "/dashboard/" });
    assert.deepEqual(subAppPlugin.transformIndexHtml(), [
      {
        tag: "script",
        attrs: { src: "/dashboard/__cue/client.js", defer: true },
        injectTo: "body",
      },
    ]);

    const disabled = agentcue({ enabled: false });
    assert.deepEqual(disabled.transformIndexHtml(), []);

    const tokenPlugin = agentcue({ token: "vite-secret-token" });
    assert.deepEqual(tokenPlugin.transformIndexHtml(), [
      {
        tag: "script",
        attrs: {
          src: "/__agentcue/client.js",
          defer: true,
        },
        injectTo: "body",
      },
    ]);
  });

  it("mounts /__agentcue middleware, dispatches Cues, passes non-plugin routes through, and closes SSE cleanly", async () => {
    const executed: AgentInvocation[] = [];
    const loggedLines: string[] = [];

    const plugin = agentcue({
      agents: ["agy", "claude"],
      defaultAgent: "agy",
      clientScript: "window.__TEST_CLIENT_LOADED__ = true;",
      executor: async (inv) => {
        executed.push(inv);
        return { ok: true, exitCode: 0 };
      },
    });

    const middlewares: Array<
      (
        req: import("node:http").IncomingMessage,
        res: import("node:http").ServerResponse,
        next: () => void
      ) => void
    > = [];

    const httpServer = createServer((req, res) => {
      let idx = 0;
      const next = () => {
        const fn = middlewares[idx++];
        if (fn) {
          fn(req, res, next);
          return;
        }
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(`vite-passthrough:${req.method}:${req.url}`);
      };
      next();
    });

    plugin.configResolved({ root: "/tmp/vite-react-app", base: "/" });
    const mockViteServer = {
      config: {
        root: "/tmp/vite-react-app",
        base: "/",
        logger: {
          info(msg: string) {
            loggedLines.push(msg);
          },
        },
      },
      middlewares: {
        use(fn: (typeof middlewares)[number]) {
          middlewares.push(fn);
        },
      },
      httpServer,
      printUrls() {
        loggedLines.push("vite:urls");
      },
    };

    plugin.configureServer(mockViteServer);
    mockViteServer.printUrls();
    assert.equal(loggedLines.length, 2);
    assert.match(loggedLines[1], /agentcue/);

    await new Promise<void>((resolve) => {
      httpServer.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = httpServer.address();
    assert.ok(addr && typeof addr === "object");
    const origin = `http://127.0.0.1:${addr.port}`;

    try {
      // 1. Non-agentcue routes and OPTIONS pass straight through to Vite
      const appRes = await fetch(`${origin}/src/App.tsx`);
      assert.equal(await appRes.text(), "vite-passthrough:GET:/src/App.tsx");

      const appOptions = await fetch(`${origin}/api/custom`, {
        method: "OPTIONS",
      });
      assert.equal(
        await appOptions.text(),
        "vite-passthrough:OPTIONS:/api/custom"
      );

      // 2. Client bundle sets relative mount path origin
      const clientRes = await fetch(`${origin}/__agentcue/client.js`);
      assert.equal(clientRes.status, 200);
      const clientJs = await clientRes.text();
      assert.match(clientJs, /window\.__AGENTCUE_ORIGIN__="\/__agentcue"/);
      assert.match(clientJs, /window\.__TEST_CLIENT_LOADED__ = true/);

      // 3. State endpoint reflects Vite root as workspace cwd
      const stateRes = await fetch(`${origin}/__agentcue/api/state`);
      const state = (await stateRes.json()) as {
        cwd: string;
        defaultAgent: string;
      };
      assert.equal(state.cwd, "/tmp/vite-react-app");
      assert.equal(state.defaultAgent, "agy");

      // 4. Open SSE stream and verify live Cue execution + clean server close
      const sseAbort = new AbortController();
      const sseRes = await fetch(`${origin}/__agentcue/api/events`, {
        signal: sseAbort.signal,
      });
      assert.equal(sseRes.status, 200);

      const cueRes = await fetch(`${origin}/__agentcue/api/cue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sampleViteCue),
      });
      assert.equal(cueRes.status, 202);

      await new Promise((r) => setTimeout(r, 30));
      assert.equal(executed.length, 1);
      assert.equal(executed[0].cwd, "/tmp/vite-react-app");
      assert.match(
        executed[0].prompt,
        /src\/components\/PricingSection\.tsx:70/
      );
      sseAbort.abort();
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  it("closes active SSE streams on closeBundle when Vite runs in middlewareMode (httpServer: null)", async () => {
    const plugin = agentcue({
      agents: ["agy"],
      clientScript: "window.__TEST_CLIENT_LOADED__ = true;",
      executor: async () => ({ ok: true, exitCode: 0 }),
    });

    const middlewares: Array<
      (
        req: import("node:http").IncomingMessage,
        res: import("node:http").ServerResponse,
        next: () => void
      ) => void
    > = [];

    const httpServer = createServer((req, res) => {
      let idx = 0;
      const next = () => {
        const fn = middlewares[idx++];
        if (fn) {
          fn(req, res, next);
          return;
        }
        res.writeHead(404);
        res.end();
      };
      next();
    });

    plugin.configResolved({ root: "/tmp/vite-react-app", base: "/vite-react/" });
    plugin.configureServer({
      config: {
        root: "/tmp/vite-react-app",
        base: "/vite-react/",
        logger: { info() {} },
      },
      middlewares: {
        use(fn) {
          middlewares.push(fn);
        },
      },
      httpServer: null,
    });

    await new Promise<void>((resolve) => {
      httpServer.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = httpServer.address();
    assert.ok(addr && typeof addr === "object");

    const sseRes = await fetch(
      `http://127.0.0.1:${addr.port}/vite-react/__agentcue/api/events`
    );
    assert.equal(sseRes.status, 200);
    const reader = sseRes.body!.getReader();
    const first = await reader.read();
    assert.equal(first.done, false);

    plugin.closeBundle();

    const ended = await Promise.race([
      reader.read().then((chunk) => chunk.done),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1500)),
    ]);
    assert.equal(ended, true, "Expected SSE stream to close on closeBundle()");

    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => (err ? reject(err) : resolve()));
      httpServer.closeAllConnections?.();
    });
  });

  it("never exposes bridge token in real Vite HTML/client responses across loopback origins while paired clients authenticate", async () => {
    const { createServer: createViteServer } = await import("vite");
    const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { createHttpBridgeTransport } = await import(
      "../src/client/transport.ts"
    );

    const tmpRoot = mkdtempSync(join(tmpdir(), "agentcue-vite-sec-"));
    writeFileSync(
      join(tmpRoot, "index.html"),
      "<!doctype html><html><head><title>Vite App</title></head><body><div id=\"app\">Hello</div></body></html>",
      "utf-8"
    );

    const secretToken = "real-vite-token-9988776655";
    const executed: AgentInvocation[] = [];

    const viteServer = await createViteServer({
      root: tmpRoot,
      configFile: false,
      logLevel: "silent",
      server: {
        host: "127.0.0.1",
        port: 0,
      },
      plugins: [
        agentcue({
          agents: ["agy"],
          defaultAgent: "agy",
          token: secretToken,
          clientScript: "window.__VITE_CLIENT_OK__ = true;",
          executor: async (inv) => {
            executed.push(inv);
            return { ok: true, exitCode: 0 };
          },
        }),
      ],
    });

    await viteServer.listen();
    const addr = viteServer.httpServer?.address();
    assert.ok(addr && typeof addr === "object");
    const viteOrigin = `http://127.0.0.1:${addr.port}`;
    const otherLoopbackOrigin = "http://localhost:49999";

    try {
      // 1. Same-origin HTML response must NOT contain the secret token
      const sameOriginHtmlRes = await fetch(`${viteOrigin}/`);
      assert.equal(sameOriginHtmlRes.status, 200);
      const sameOriginHtml = await sameOriginHtmlRes.text();
      assert.ok(sameOriginHtml.includes("/__agentcue/client.js"));
      assert.equal(
        sameOriginHtml.includes(secretToken),
        false,
        "Vite index.html must never embed the bridge token"
      );
      assert.equal(
        sameOriginHtml.includes("data-token"),
        false,
        "Vite index.html must not include data-token attribute"
      );

      // 2. Cross-origin loopback request to Vite HTML is rejected (403) and never leaks token
      const crossLoopbackHtmlRes = await fetch(`${viteOrigin}/`, {
        headers: {
          Origin: otherLoopbackOrigin,
          "Sec-Fetch-Site": "cross-site",
        },
      });
      assert.equal(crossLoopbackHtmlRes.status, 403);
      assert.equal(
        crossLoopbackHtmlRes.headers.get("access-control-allow-origin"),
        null
      );
      const crossLoopbackBody = await crossLoopbackHtmlRes.text();
      assert.equal(crossLoopbackBody.includes(secretToken), false);

      // 3. Cross-origin loopback request to /__agentcue/client.js never contains the token
      const crossLoopbackClientRes = await fetch(
        `${viteOrigin}/__agentcue/client.js`,
        {
          headers: { Origin: otherLoopbackOrigin },
        }
      );
      assert.equal(crossLoopbackClientRes.status, 200);
      const clientJs = await crossLoopbackClientRes.text();
      assert.equal(clientJs.includes(secretToken), false);
      assert.equal(clientJs.includes("__AGENTCUE_TOKEN__"), false);

      // 4. Unauthenticated API call fails closed with 401
      const unauthCue = await fetch(`${viteOrigin}/__agentcue/api/cue`, {
        method: "POST",
        headers: {
          Origin: otherLoopbackOrigin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(sampleViteCue),
      });
      assert.equal(unauthCue.status, 401);
      assert.equal(executed.length, 0);

      // 5. Intended paired client (with token provisioned via ?agentcue_token / transport) succeeds
      const pairedTransport = createHttpBridgeTransport(
        `${viteOrigin}/__agentcue`,
        secretToken
      );
      const dispatchRes = await pairedTransport.sendCue(sampleViteCue);
      assert.equal(dispatchRes.ok, true);
      assert.equal(dispatchRes.status, 202);
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(executed.length, 1);
    } finally {
      await viteServer.close();
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
