# agentcue

**Cue the Agent.** Pick a DOM node in the browser and send it straight to your Agent CLI so it edits your code immediately.

## Why

Terminal coding agents (`cursor`, `agy`, `codex`, `claude`) cannot see your rendered page. Explaining visual bugs in prose ("move the second button on the left 8px right and match the header font size") is slow and imprecise.

Most visual feedback tools drop annotations into a passive MCP server — you click in the browser, switch back to the terminal, and manually prompt the agent to fetch pending tasks.

**agentcue** turns Pull into **Push**: point at a DOM node, type what you want changed, and `agentcue` dispatches the element context directly into your running Agent CLI.

## How It Works

```text
Browser (pick DOM + note) ──► local agentcue daemon ──► Agent CLI (cursor / agy / codex) ──► HMR reload
```

1. **Point & cue in browser** — Hover and click any element on your local dev page (React, Vue, Svelte, Astro, Rails, or plain HTML).
2. **Capture DOM context** — Extracts a stable CSS selector, trimmed outer HTML, key computed styles, bounding box, and source file/line hints when available.
3. **Dispatch to Agent CLI** — Pipes a compact, structured prompt straight into your target CLI so the agent locates the file and edits it right away.

## Target Agent CLIs

| Agent          | CLI      | Dispatch mode                          |
| -------------- | -------- | -------------------------------------- |
| Cursor         | `cursor` | CLI prompt / active workspace dispatch |
| Antigravity    | `agy`    | Direct prompt injection (`agy`)        |
| OpenAI Codex   | `codex`  | CLI prompt / session pipe              |
| Claude Code    | `claude` | CLI prompt / session pipe              |
| Custom command | `$CMD`   | Stdin or template args (`{{prompt}}`)  |

## CLI Sketch

```bash
# Start local bridge and dispatch cues to Antigravity CLI
npx agentcue agy

# Dispatch cues to Cursor CLI or Codex
npx agentcue cursor
npx agentcue codex

# Pipe into any custom agent command
npx agentcue --cmd "my-agent prompt"
```

## Design Principles

- **Push, not Pull** — Submitting an annotation triggers the CLI immediately; no manual terminal context-switching.
- **Framework-agnostic** — Operates on standard DOM APIs with zero React/Vue lock-in and zero production bundle pollution.
- **Small, sharp context** — Sends exact selectors, DOM structure, styles, and source hints instead of noisy full-page dumps.

## Status

Early stage — defining protocol and minimal local dispatcher.

## License

MIT
