import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_EXTENSION_SETTINGS,
  STORAGE_SETTINGS_KEY,
} from "../src/protocol.ts";
import { createSharedSseHub } from "../src/background.ts";

type StorageListener = (
  changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
  area: string
) => void;

interface MockPort {
  name: string;
  postMessage: (msg: unknown) => void;
  disconnect: () => void;
  onMessage: { addListener: (fn: (msg: unknown) => void) => void };
  onDisconnect: { addListener: (fn: () => void) => void };
}

function createMockPort(name = "agentcue-sse"): MockPort {
  const disconnectListeners: Array<() => void> = [];
  return {
    name,
    postMessage: () => {},
    disconnect: () => {
      for (const fn of [...disconnectListeners]) fn();
    },
    onMessage: { addListener: () => {} },
    onDisconnect: { addListener: (fn) => disconnectListeners.push(fn) },
  };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function installDeferredHubMocks() {
  const settings = { ...DEFAULT_EXTENSION_SETTINGS };
  const pendingGets: Array<() => void> = [];
  const storageListeners = new Set<StorageListener>();
  const upstreams: Array<{ url: string; signal: AbortSignal }> = [];

  const prevChrome = (globalThis as Record<string, unknown>).chrome;
  const prevFetch = globalThis.fetch;

  const chrome = {
    storage: {
      local: {
        get: (key?: string | string[] | null) =>
          new Promise<Record<string, unknown>>((resolve) => {
            pendingGets.push(() => {
              const value = { ...settings };
              if (Array.isArray(key)) {
                const out: Record<string, unknown> = {};
                for (const k of key) {
                  if (k === STORAGE_SETTINGS_KEY) out[k] = value;
                }
                resolve(out);
                return;
              }
              resolve(key ? { [key]: value } : { [STORAGE_SETTINGS_KEY]: value });
            });
          }),
      },
      onChanged: {
        addListener: (fn: StorageListener) => storageListeners.add(fn),
      },
    },
  };

  const fetchImpl = async (input: string | URL, init?: RequestInit) => {
    const signal = init?.signal;
    if (!signal) {
      throw new Error("Expected upstream fetch to provide an AbortSignal");
    }
    upstreams.push({ url: String(input), signal });
    return new Response(
      new ReadableStream({
        start(controller) {
          signal.addEventListener("abort", () => {
            try {
              controller.close();
            } catch {
              // already closed
            }
          });
        },
      }),
      { status: 200, headers: { "Content-Type": "text/event-stream" } }
    );
  };

  (globalThis as Record<string, unknown>).chrome = chrome;
  globalThis.fetch = fetchImpl as typeof fetch;

  return {
    pendingGets,
    upstreams,
    liveUpstreams: () => upstreams.filter((u) => !u.signal.aborted),
    resolvePendingGets: async () => {
      const resolvers = pendingGets.splice(0, pendingGets.length);
      for (const resolve of resolvers) resolve();
      await flush();
    },
    changeBridgeOrigin: (bridgeOrigin: string) => {
      const oldValue = { ...settings };
      settings.bridgeOrigin = bridgeOrigin;
      for (const fn of [...storageListeners]) {
        fn(
          {
            [STORAGE_SETTINGS_KEY]: {
              oldValue,
              newValue: { ...settings },
            },
          },
          "local"
        );
      }
    },
    restore: () => {
      (globalThis as Record<string, unknown>).chrome = prevChrome;
      globalThis.fetch = prevFetch;
    },
  };
}

describe("@agentcue/extension shared SSE hub lifecycle", () => {
  it("aborts stale upstreams after a pending-load disconnect/reconnect and after the last subscriber leaves", async () => {
    const mocks = installDeferredHubMocks();

    try {
      const hub = createSharedSseHub();

      const portA = createMockPort();
      hub.attach(portA as unknown as chrome.runtime.Port);
      assert.equal(mocks.pendingGets.length, 1);
      assert.equal(mocks.upstreams.length, 0);

      portA.disconnect();
      const portB = createMockPort();
      hub.attach(portB as unknown as chrome.runtime.Port);
      assert.equal(mocks.pendingGets.length, 2);

      await mocks.resolvePendingGets();

      assert.equal(mocks.upstreams.length, 1);
      assert.equal(mocks.liveUpstreams().length, 1);
      assert.equal(
        mocks.liveUpstreams()[0].url,
        `${DEFAULT_EXTENSION_SETTINGS.bridgeOrigin}/api/events`
      );

      portB.disconnect();
      await flush();

      assert.equal(mocks.upstreams.length, 1);
      assert.equal(mocks.liveUpstreams().length, 0);
      assert.equal(mocks.upstreams[0].signal.aborted, true);
    } finally {
      mocks.restore();
    }
  });

  it("keeps a single live upstream when the Bridge origin changes during a pending connect", async () => {
    const mocks = installDeferredHubMocks();

    try {
      const hub = createSharedSseHub();
      const port = createMockPort();
      hub.attach(port as unknown as chrome.runtime.Port);
      assert.equal(mocks.pendingGets.length, 1);

      mocks.changeBridgeOrigin("http://127.0.0.1:5000");
      assert.equal(mocks.pendingGets.length, 2);

      await mocks.resolvePendingGets();

      const live = mocks.liveUpstreams();
      assert.equal(mocks.upstreams.length, 1);
      assert.equal(live.length, 1);
      assert.equal(live[0].url, "http://127.0.0.1:5000/api/events");

      port.disconnect();
      await flush();
      assert.equal(mocks.liveUpstreams().length, 0);
    } finally {
      mocks.restore();
    }
  });
});
