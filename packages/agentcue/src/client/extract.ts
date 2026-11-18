import type { PinContext } from "../shared/types.ts";

const STYLE_KEYS = [
  "display",
  "fontSize",
  "fontWeight",
  "color",
  "backgroundColor",
  "padding",
  "margin",
  "borderRadius",
  "gap",
] as const;

function escapeCss(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/([^a-zA-Z0-9_-])/g, "\\$1");
}

function isStableId(id: string): boolean {
  if (!id) return false;
  if (id.includes(":") || /^radix-|^headlessui-|^\d+$/.test(id)) return false;
  return id.length <= 48;
}

function pickMeaningfulClasses(el: Element, max = 2): string[] {
  const classes = Array.from(el.classList).filter(
    (cls) =>
      cls.length > 1 &&
      cls.length <= 36 &&
      !/^css-[a-z0-9]+$|^sc-[a-zA-Z0-9]+$|^svelte-[a-z0-9]+$/.test(cls)
  );
  return classes.slice(0, max);
}

function buildNodeSegment(el: Element, includeNth = false): string {
  const tag = el.tagName.toLowerCase();
  if (el.id && isStableId(el.id)) {
    return `#${escapeCss(el.id)}`;
  }

  const testId =
    el.getAttribute("data-testid") || el.getAttribute("data-test-id");
  if (testId) {
    const attr = el.hasAttribute("data-testid")
      ? "data-testid"
      : "data-test-id";
    return `${tag}[${attr}="${testId.replace(/"/g, '\\"')}"]`;
  }

  const classes = pickMeaningfulClasses(el, 2);
  let segment =
    classes.length > 0
      ? `${tag}.${classes.map((c) => escapeCss(c)).join(".")}`
      : tag;

  if (includeNth && el.parentElement) {
    const siblings = Array.from(el.parentElement.children).filter(
      (sib) => sib.tagName === el.tagName
    );
    if (siblings.length > 1) {
      const index = siblings.indexOf(el) + 1;
      segment += `:nth-of-type(${index})`;
    }
  }

  return segment;
}

export function getStableSelector(el: Element): string {
  const doc = el.ownerDocument;
  if (el.id && isStableId(el.id)) {
    return `#${escapeCss(el.id)}`;
  }

  const parts: string[] = [];
  let current: Element | null = el;
  let depth = 0;

  while (current && current.tagName.toLowerCase() !== "html" && depth < 6) {
    const tag = current.tagName.toLowerCase();
    if (tag === "body") {
      parts.unshift("body");
      break;
    }

    const segment = buildNodeSegment(current, true);
    parts.unshift(segment);

    const candidate = parts.join(" > ");
    try {
      if (doc.querySelectorAll(candidate).length === 1) {
        return candidate;
      }
    } catch {
      // Continue climbing if selector syntax needs ancestor context
    }

    if (segment.startsWith("#")) break;
    current = current.parentElement;
    depth++;
  }

  return parts.join(" > ") || el.tagName.toLowerCase();
}

export function getBreadcrumb(el: Element): string {
  const chain: string[] = [];
  let current: Element | null = el;
  let count = 0;

  while (current && count < 5) {
    const tag = current.tagName.toLowerCase();
    if (tag === "html") break;
    if (tag === "body") {
      chain.unshift("body");
      break;
    }
    const classes = pickMeaningfulClasses(current, 1);
    const label =
      current.id && isStableId(current.id)
        ? `${tag}#${current.id}`
        : classes.length > 0
          ? `${tag}.${classes[0]}`
          : tag;
    chain.unshift(label);
    current = current.parentElement;
    count++;
  }

  return chain.join(" > ");
}

export function trimOuterHTML(el: Element, maxLength = 500): string {
  const clone = el.cloneNode(true) as Element;

  const svgs = clone.tagName.toLowerCase() === "svg"
    ? [clone]
    : Array.from(clone.querySelectorAll("svg"));
  for (const svg of svgs) {
    if (svg.innerHTML.length > 80) {
      svg.innerHTML = "<!-- svg -->";
    }
  }

  const raw = clone.outerHTML.replace(/\s+/g, " ").trim();
  if (raw.length <= maxLength) return raw;
  return `${raw.slice(0, maxLength - 15)}...<!--truncated-->`;
}

function parseReactDebugStack(stack: string): string | undefined {
  const lines = stack.split("\n");
  for (const line of lines) {
    if (
      line.includes("react-stack-top-frame") ||
      line.includes("node_modules") ||
      line.includes("react_jsx") ||
      line.includes("react-dom") ||
      line.includes("/@vite/") ||
      line.includes("__agentcue")
    ) {
      continue;
    }
    const urlMatch = line.match(/https?:\/\/[^/]+\/([^\s:)]+):(\d+)(?::\d+)?/);
    if (urlMatch) {
      let cleanPath = urlMatch[1].split("?")[0];
      if (cleanPath.startsWith("@fs/")) {
        cleanPath = `/${cleanPath.slice(4)}`;
      }
      return `${cleanPath}:${urlMatch[2]}`;
    }
  }
  return undefined;
}

export function detectFrameworkHints(el: Element): {
  sourceHint?: string;
  componentStack?: string;
} {
  let sourceHint: string | undefined;
  const components: string[] = [];

  // 1. Standard / framework dev data attributes (walk up to body)
  let attrNode: Element | null = el;
  for (let i = 0; i < 12 && attrNode && !sourceHint; i++) {
    const directSource = attrNode.getAttribute("data-source");
    if (directSource) {
      sourceHint = directSource;
      break;
    }

    const astroFile = attrNode.getAttribute("data-astro-source-file");
    if (astroFile) {
      const astroLoc = attrNode.getAttribute("data-astro-source-loc");
      sourceHint = astroLoc ? `${astroFile}:${astroLoc}` : astroFile;
      break;
    }

    const vitePath =
      attrNode.getAttribute("data-inspector-relative-path") ||
      attrNode.getAttribute("data-v-inspector-file");
    if (vitePath) {
      const line =
        attrNode.getAttribute("data-inspector-line") ||
        attrNode.getAttribute("data-v-inspector-line");
      sourceHint = line ? `${vitePath}:${line}` : vitePath;
      break;
    }

    attrNode = attrNode.parentElement;
  }

  const anyEl = el as unknown as Record<string, unknown>;

  // 2. Svelte dev metadata
  const svelteMeta = anyEl.__svelte_meta as
    | { loc?: { file?: string; line?: number; column?: number } }
    | undefined;
  if (!sourceHint && svelteMeta?.loc?.file) {
    const { file, line } = svelteMeta.loc;
    sourceHint = line != null ? `${file}:${line}` : file;
  }

  // 3. Vue 3 component instance
  let vueComp = anyEl.__vueParentComponent as
    | {
        type?: { name?: string; __name?: string; __file?: string };
        parent?: unknown;
      }
    | undefined;
  let hops = 0;
  while (vueComp && hops < 6) {
    const name = vueComp.type?.__name || vueComp.type?.name;
    if (name && !components.includes(`<${name}>`)) {
      components.unshift(`<${name}>`);
    }
    if (!sourceHint && vueComp.type?.__file) {
      sourceHint = vueComp.type.__file;
    }
    vueComp = vueComp.parent as typeof vueComp;
    hops++;
  }

  // 4. React Fiber tree
  const fiberKey = Object.keys(el).find(
    (k) =>
      k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$")
  );
  if (fiberKey) {
    let fiber = anyEl[fiberKey] as
      | {
          type?: { displayName?: string; name?: string } | string;
          _debugSource?: { fileName?: string; lineNumber?: number };
          _debugStack?: { stack?: string };
          return?: unknown;
        }
      | undefined;
    let reactHops = 0;
    while (fiber && reactHops < 12) {
      if (!sourceHint && fiber._debugSource?.fileName) {
        const { fileName, lineNumber } = fiber._debugSource;
        sourceHint =
          lineNumber != null ? `${fileName}:${lineNumber}` : fileName;
      }
      if (!sourceHint && fiber._debugStack?.stack) {
        sourceHint = parseReactDebugStack(fiber._debugStack.stack);
      }
      if (fiber.type && typeof fiber.type === "function") {
        const fnType = fiber.type as { displayName?: string; name?: string };
        const name = fnType.displayName || fnType.name;
        if (
          name &&
          /^[A-Z]/.test(name) &&
          components.length < 4 &&
          components[0] !== `<${name}>`
        ) {
          components.unshift(`<${name}>`);
        }
      }
      fiber = fiber.return as typeof fiber;
      reactHops++;
    }
  }

  return {
    sourceHint,
    componentStack:
      components.length > 0 ? components.join(" > ") : undefined,
  };
}

export function extractPinContext(el: Element): PinContext {
  const win = el.ownerDocument.defaultView;
  const computed = win ? win.getComputedStyle(el) : null;
  const styles: Record<string, string> = {};

  if (computed) {
    for (const key of STYLE_KEYS) {
      const cssProp = key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
      const val = computed.getPropertyValue(cssProp);
      if (val) styles[cssProp] = val;
    }
  }

  const rect = el.getBoundingClientRect();
  const rawText = (el.textContent || "").replace(/\s+/g, " ").trim();
  const textExcerpt =
    rawText.length > 140 ? `${rawText.slice(0, 140)}…` : rawText;

  const { sourceHint, componentStack } = detectFrameworkHints(el);

  return {
    tagName: el.tagName.toLowerCase(),
    selector: getStableSelector(el),
    breadcrumb: getBreadcrumb(el),
    outerHTML: trimOuterHTML(el),
    textExcerpt,
    computedStyles: styles,
    boundingBox: {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    },
    sourceHint,
    componentStack,
  };
}
