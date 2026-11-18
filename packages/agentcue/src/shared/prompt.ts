import type { CuePayload, PinPayload } from "./types.ts";

function formatStylesInline(styles: Record<string, string>): string {
  const entries = Object.entries(styles).filter(
    ([, val]) => val && val !== "none" && val !== "normal" && val !== "0px"
  );
  if (entries.length === 0) return "";
  return entries.map(([k, v]) => `${k}: ${v}`).join("; ");
}

function formatPinSection(pin: PinPayload): string {
  const { context, note, index } = pin;
  const lines: string[] = [];

  lines.push(`### Pin #${index}: ${note.trim()}`);
  if (context.sourceHint) {
    lines.push(`- **Source hint**: \`${context.sourceHint}\``);
  }
  if (context.componentStack) {
    lines.push(`- **Component tree**: \`${context.componentStack}\``);
  }
  lines.push(`- **Selector**: \`${context.selector}\``);
  lines.push(`- **DOM path**: \`${context.breadcrumb}\``);

  const { width, height, x, y } = context.boundingBox;
  lines.push(`- **Box**: ${Math.round(width)}×${Math.round(height)}px at (${Math.round(x)}, ${Math.round(y)})`);

  if (context.textExcerpt) {
    lines.push(`- **Visible text**: ${JSON.stringify(context.textExcerpt)}`);
  }

  const styleSummary = formatStylesInline(context.computedStyles);
  if (styleSummary) {
    lines.push(`- **Computed styles**: \`${styleSummary}\``);
  }

  lines.push("- **DOM snippet**:");
  lines.push("```html");
  lines.push(context.outerHTML);
  lines.push("```");

  return lines.join("\n");
}

export function formatCuePrompt(cue: CuePayload): string {
  const urlPath = (() => {
    try {
      const parsed = new URL(cue.pageUrl);
      return `${parsed.pathname}${parsed.search}${parsed.hash}` || "/";
    } catch {
      return cue.pageUrl || "/";
    }
  })();

  const header = [
    "Apply the following visual UI changes directly to the source files in this workspace.",
    "Locate the exact source files using the selectors, visible text, DOM structure, and source hints below, then make minimal, clean edits.",
    "",
    `- **Page**: \`${urlPath}\`${cue.pageTitle ? ` (${cue.pageTitle})` : ""}`,
    `- **Total Pins**: ${cue.pins.length}`,
  ].join("\n");

  const pinBlocks = cue.pins.map((pin, idx) =>
    formatPinSection({ ...pin, index: idx + 1 })
  );

  return [header, ...pinBlocks].join("\n\n") + "\n";
}
