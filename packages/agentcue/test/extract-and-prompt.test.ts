import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatCuePrompt } from "../src/shared/prompt.ts";
import { detectFrameworkHints } from "../src/client/extract.ts";

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
