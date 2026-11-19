import { detectMainWorldFrameworkHints } from "../../agentcue/src/client/extract.ts";
import { HINT_REQUEST_EVENT, HINT_RESPONSE_EVENT } from "./protocol.ts";

const EXTRACTOR_GUARD = Symbol.for("agentcue.mainWorldHintExtractor");

type GuardedDocument = Document & { [EXTRACTOR_GUARD]?: boolean };

/**
 * Read-only MAIN-world helper: listens for DOM hint requests from the isolated
 * extension overlay and replies synchronously with React/Vue/Svelte component
 * metadata. It has no access to chrome.runtime and cannot dispatch Cues.
 */
export function initPageHintExtractor(doc: Document = document): () => void {
  const guarded = doc as GuardedDocument;
  if (guarded[EXTRACTOR_GUARD]) {
    return () => {};
  }
  guarded[EXTRACTOR_GUARD] = true;

  const handler = (evt: Event) => {
    const target = evt.target as Element | null;
    if (!target || typeof target !== "object" || typeof target.tagName !== "string") {
      return;
    }
    try {
      const hints = detectMainWorldFrameworkHints(target);
      if (hints.sourceHint || hints.componentStack) {
        doc.dispatchEvent(
          new CustomEvent(HINT_RESPONSE_EVENT, {
            detail: JSON.stringify(hints),
          })
        );
      }
    } catch {
      // Ignore extraction errors from hostile or exotic page objects
    }
  };

  doc.addEventListener(HINT_REQUEST_EVENT, handler);

  return () => {
    doc.removeEventListener(HINT_REQUEST_EVENT, handler);
    delete guarded[EXTRACTOR_GUARD];
  };
}

if (typeof document !== "undefined") {
  initPageHintExtractor(document);
}
