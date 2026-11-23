import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatCuePrompt } from "../src/shared/prompt.ts";
import { detectFrameworkHints } from "../src/client/extract.ts";
import { renderAgentMenuDom } from "../src/client/dom.ts";
import { mountOverlay } from "../src/client/overlay.ts";
import type { AgentId, ServerEvent } from "../src/shared/types.ts";
import type { BridgeTransportHandlers } from "../src/client/transport.ts";

describe("formatCuePrompt", () => {
  it("formats multiple Pins into a clean structured Markdown prompt", () => {
    const md = formatCuePrompt({
      agent: "cursor-agent",
      continueSession: false,
      pageUrl: "http://localhost:5173/pricing#pro",
      pageTitle: "Pricing Page",
      pins: [
        {
          index: 1,
          note: "Change badge background to emerald",
          context: {
            tagName: "span",
            selector: "#hero-badge",
            breadcrumb: "body > section.hero > span#hero-badge",
            outerHTML: '<span id="hero-badge" class="badge">Pro</span>',
            textExcerpt: "Pro",
            computedStyles: { "font-size": "12px", margin: "0px" },
            boundingBox: { x: 10, y: 20, width: 50, height: 22 },
            sourceHint: "src/pages/Pricing.tsx:14",
          },
        },
        {
          index: 2,
          note: "Increase gap between buttons to 16px",
          context: {
            tagName: "div",
            selector: "section.hero > div.actions",
            breadcrumb: "body > section.hero > div.actions",
            outerHTML: '<div class="actions"><button>Buy</button></div>',
            textExcerpt: "Buy",
            computedStyles: { display: "flex", gap: "8px" },
            boundingBox: { x: 10, y: 80, width: 240, height: 40 },
          },
        },
      ],
    });

    assert.match(md, /- \*\*Page\*\*: `\/pricing#pro` \(Pricing Page\)/);
    assert.match(md, /- \*\*Total Pins\*\*: 2/);
    assert.match(md, /### Pin #1: Change badge background to emerald/);
    assert.match(md, /- \*\*Source hint\*\*: `src\/pages\/Pricing\.tsx:14`/);
    assert.match(md, /### Pin #2: Increase gap between buttons to 16px/);
    assert.doesNotMatch(md, /margin: 0px/);
  });
});

describe("detectFrameworkHints", () => {
  it("extracts React Fiber component stack and _debugSource when present", () => {
    const fakeEl = {
      getAttribute: () => null,
      parentElement: null,
      __reactFiber$xyz: {
        type: function PrimaryButton() {},
        _debugSource: { fileName: "src/Button.tsx", lineNumber: 19 },
        return: {
          type: function HeroCard() {},
          return: null,
        },
      },
    } as unknown as Element;

    const hints = detectFrameworkHints(fakeEl);
    assert.equal(hints.sourceHint, "src/Button.tsx:19");
    assert.equal(hints.componentStack, "<HeroCard> > <PrimaryButton>");
  });

  it("extracts React 19 _debugStack file and line when _debugSource is absent", () => {
    const fakeReact19El = {
      getAttribute: () => null,
      parentElement: null,
      __reactFiber$r19: {
        type: function PlanCard() {},
        _debugStack: {
          stack: [
            "Error: react-stack-top-frame",
            "    at jsxDEV (http://localhost:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=1234:280:25)",
            "    at PlanCard (http://localhost:5173/src/components/PricingSection.tsx?t=1730000:72:7)",
          ].join("\n"),
        },
        return: {
          type: function PricingSection() {},
          return: null,
        },
      },
    } as unknown as Element;

    const hints = detectFrameworkHints(fakeReact19El);
    assert.equal(hints.sourceHint, "src/components/PricingSection.tsx:72");
    assert.equal(hints.componentStack, "<PricingSection> > <PlanCard>");
  });
});

interface FakeNode {
  tagName: string;
  id: string;
  className: string;
  textContent: string;
  children: FakeNode[];
  innerHTMLUsed: boolean;
  classList: {
    add: (...t: string[]) => void;
    remove: (...t: string[]) => void;
    toggle: (t: string, f?: boolean) => void;
    contains: (t: string) => boolean;
  };
  style: Record<string, string>;
  appendChild: (child: FakeNode) => FakeNode;
  addEventListener: () => void;
  removeEventListener: () => void;
  setAttribute: () => void;
  remove: () => void;
  shadowRoot?: {
    innerHTML: string;
    getElementById: (id: string) => FakeNode;
    addEventListener: () => void;
  };
  attachShadow?: (init: { mode: "open" | "closed" }) => {
    innerHTML: string;
    getElementById: (id: string) => FakeNode;
    addEventListener: () => void;
  };
}

function makeFakeNode(tag: string): FakeNode {
  const classes = new Set<string>();
  let html = "";
  const byId = new Map<string, FakeNode>();
  const node: FakeNode = {
    tagName: tag.toUpperCase(),
    id: "",
    className: "",
    textContent: "",
    children: [],
    innerHTMLUsed: false,
    classList: {
      add: (...t) => t.forEach((x) => classes.add(x)),
      remove: (...t) => t.forEach((x) => classes.delete(x)),
      toggle: (t, f) => {
        if (f === true) classes.add(t);
        else if (f === false) classes.delete(t);
        else if (classes.has(t)) classes.delete(t);
        else classes.add(t);
      },
      contains: (t) => classes.has(t),
    },
    style: {},
    appendChild(child) {
      node.children.push(child);
      return child;
    },
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    remove() {},
    attachShadow() {
      const shadow = {
        get innerHTML() {
          return html;
        },
        set innerHTML(val: string) {
          html = val;
          byId.clear();
          const re = /<([a-z0-9-]+)[^>]*\bid="([^"]+)"/gi;
          let m: RegExpExecArray | null;
          while ((m = re.exec(val)) !== null) {
            const el = makeFakeNode(m[1]);
            el.id = m[2];
            byId.set(m[2], el);
          }
        },
        getElementById(id: string) {
          let el = byId.get(id);
          if (!el) {
            el = makeFakeNode("div");
            el.id = id;
            byId.set(id, el);
          }
          return el;
        },
        addEventListener() {},
      };
      node.shadowRoot = shadow;
      return shadow;
    },
  };
  Object.defineProperty(node, "innerHTML", {
    get() {
      return html;
    },
    set(val: string) {
      html = val;
      if (val !== "") {
        node.innerHTMLUsed = true;
      }
      node.children = [];
    },
  });
  return node;
}

describe("renderAgentMenuDom & SSE state agent validation (#16)", () => {
  it("builds agent menu buttons via createElement and textContent without innerHTML interpolation", () => {
    const prevDoc = globalThis.document;
    globalThis.document = {
      createElement: (tag: string) => makeFakeNode(tag),
    } as unknown as Document;

    try {
      const label = makeFakeNode("span");
      const listEl = makeFakeNode("div");
      const maliciousPayload = `<img src=x onerror="alert(1)">` as unknown as AgentId;

      renderAgentMenuDom(
        label as unknown as HTMLSpanElement,
        listEl as unknown as HTMLDivElement,
        ["agy", maliciousPayload],
        "agy",
        () => {}
      );

      assert.equal(label.textContent, "agy");
      assert.equal(listEl.children.length, 2);
      for (const btn of listEl.children) {
        assert.equal(
          btn.innerHTMLUsed,
          false,
          "Expected button children to be built via createElement, not innerHTML"
        );
      }
      const secondBtn = listEl.children[1];
      const leftSpan = secondBtn.children[0];
      const nameSpan = leftSpan.children[1];
      assert.equal(nameSpan.textContent, `<img src=x onerror="alert(1)">`);
      assert.equal(nameSpan.children.length, 0);
    } finally {
      globalThis.document = prevDoc;
    }
  });

  it("filters unvalidated SSE state.agents and state.defaultAgent against SUPPORTED_AGENTS", () => {
    const prevDoc = globalThis.document;
    const prevWin = globalThis.window;

    const docRoot = makeFakeNode("html");
    globalThis.document = {
      documentElement: docRoot,
      createElement: (tag: string) => makeFakeNode(tag),
    } as unknown as Document;
    globalThis.window = {
      addEventListener() {},
      removeEventListener() {},
    } as unknown as Window & typeof globalThis;

    let sseHandlers: BridgeTransportHandlers | null = null;
    const overlay = mountOverlay("http://localhost:4318", {
      transport: {
        sendCue: async () => ({ ok: true, status: 202, cueId: "c1" }),
        subscribeEvents: (handlers) => {
          sseHandlers = handlers;
          return () => {};
        },
      },
      stateStore: {
        getSelectedAgent: () => null,
        setSelectedAgent: () => {},
        loadActiveSessions: () => new Set(),
        saveActiveSessions: () => {},
      },
    });

    try {
      assert.ok(sseHandlers);
      const host = docRoot.children[0];
      assert.ok(host);

      // Inject malicious / unknown agents in SSE state event
      (sseHandlers as BridgeTransportHandlers).onEvent({
        type: "state",
        state: {
          cwd: "/tmp/test",
          agents: [
            `<img src=x onerror=alert(1)>` as unknown as AgentId,
            "claude",
            "unknown-cli" as unknown as AgentId,
            "codex",
          ],
          defaultAgent: `<script>evil()</script>` as unknown as AgentId,
          status: "idle",
          activeCue: null,
          queuedCount: 0,
          lastResult: null,
        },
      } satisfies ServerEvent);

      // Verify only valid SUPPORTED_AGENTS ("claude", "codex") were accepted and malicious defaultAgent was rejected
      const shadow = host.shadowRoot!;
      const agentMenuList = shadow.getElementById("agentMenuList");
      const agentLabel = shadow.getElementById("agentLabel");
      const renderedAgents = agentMenuList.children.map(
        (btn) => btn.children[0].children[1].textContent
      );
      assert.deepEqual(renderedAgents, ["claude", "codex"]);
      assert.equal(agentLabel.textContent, "claude");

      // When a valid defaultAgent in the filtered list is sent, it is selected
      (sseHandlers as BridgeTransportHandlers).onEvent({
        type: "state",
        state: {
          cwd: "/tmp/test",
          agents: ["claude", "codex"],
          defaultAgent: "codex",
          status: "idle",
          activeCue: null,
          queuedCount: 0,
          lastResult: null,
        },
      } satisfies ServerEvent);
      assert.equal(agentLabel.textContent, "codex");
    } finally {
      overlay.destroy();
      globalThis.document = prevDoc;
      globalThis.window = prevWin;
    }
  });
});
