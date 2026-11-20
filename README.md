# <picture><source media="(prefers-color-scheme: dark)" srcset="./logo-dark.svg" /><img src="./logo.svg" alt="" width="28" height="28" align="absmiddle" /></picture> agentcue

**Cue the Agent.** Pick one or more DOM elements in the browser, jot down quick UI edits, and push the batch straight to your local Agent CLI (`agy`, `claude`, `cursor-agent`, `codex`, `pi`) so it edits your code immediately.

## Why

Terminal coding agents cannot see your rendered page. Explaining visual tweaks in prose ("move the second button on the left 8px right and match the header font size") is slow and imprecise.

Most visual feedback tools either lock into React or drop annotations into a passive MCP server where you still have to switch back to the terminal and ask the agent to pull tasks.

**agentcue** turns Pull into **Push** with an Agentation-inspired floating overlay: pick multiple spots (**Pin**s), press `S` (or `Cmd/Ctrl + Enter`), and `agentcue` dispatches a compact structured **Cue** directly into your chosen **Agent Target**.

## How It Works

```text
Browser (activate + pick Pins) ──► local agentcue bridge ──► Agent CLI (agy / claude / cursor-agent / codex / pi) ──► HMR reload
```

1. **Activate & pick in browser** — Press `Cmd/Ctrl + Shift + F` (or click the collapsed `✦` launcher) to enter **Pick Mode**, then click one or more elements on your local dev page to drop numbered **Pin**s with brief change notes.
2. **Capture sharp DOM & source context** — Each **Pin** extracts a stable CSS selector, DOM breadcrumb, trimmed `outerHTML`, visible text, key computed styles, bounding box, and opportunistic framework source/component hints (React Fiber, Vue, Svelte, Astro, `data-*` attributes).
3. **Push Cue straight to Agent CLI** — Press `S` (or `Cmd/Ctrl + Enter`) to send the batch to the local `agentcue` bridge, which queues and runs your selected **Agent Target** in workspace auto-edit mode while streaming live status over SSE back to the browser.

## Usage

### Vite Plugin (`agentcue/vite`)

Install `agentcue` and register the plugin to mount `/__agentcue/*` onto Vite's dev server — automatic `<script>` injection in `vite` dev mode and zero impact on `vite build`:

```bash
npm add -D agentcue
```

```ts
// vite.config.ts
import { defineConfig } from "vite";
import agentcue from "agentcue/vite";

export default defineConfig({
  plugins: [agentcue()],
});
```

### Standalone CLI (Any Framework or Plain HTML)

Start the local bridge in any frontend project (Next.js, React, Vue, Svelte, Astro, Rails, or plain HTML) with zero build setup. It automatically detects all installed Agent CLIs (`agy`, `claude`, `cursor-agent`, `codex`, `pi`) so you can switch targets freely in the browser:

```bash
# Start local bridge in current workspace (default port: 4318)
npx agentcue

# Or customize port and target workspace directory
npx agentcue --port 4318 --cwd /path/to/your-frontend
```

Then attach the overlay in the browser using any output printed in your terminal:

- **Script tag**: add `<script src="http://localhost:4318/client.js"></script>` to your dev HTML
- **Bookmarklet**: run the zero-config Bookmarklet URL on any local page
- **Built-in playground**: open `http://localhost:4318/demo` to test live edits immediately

### Browser Extension (Chrome / Edge / Arc / Brave)

Use the Manifest V3 browser extension (`packages/extension`) to activate **Pick Mode** on any tab with a single toolbar click or `Cmd/Ctrl + Shift + F`, while automatically mounting the collapsed `✦` launcher on `localhost` / `127.0.0.1` dev servers. See [Browser Extension Version](#browser-extension-version) for download and manual install.

## Browser Extension Version

The browser extension ships with the **same version** as the `agentcue` npm package and the GitHub release tag (`vX.Y.Z`).

**Download (latest):** [`agentcue-extension.zip`](https://github.com/yuler/agentcue/releases/latest/download/agentcue-extension.zip)

Each [GitHub Release](https://github.com/yuler/agentcue/releases) also attaches a versioned asset such as `agentcue-extension-vX.Y.Z.zip`.

### Manual install (Chrome / Edge / Arc / Brave)

1. Download and unzip `agentcue-extension.zip`.
2. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the unzipped folder.
3. Start `npx agentcue` in your project workspace (or use `C` / **Copy Markdown** standalone without a local bridge). Right-click the extension icon to configure Bridge URL or `localhost` auto-mount.

For local development builds: `mise run extension:build` → `packages/extension/dist`.

## Browser Shortcuts

| Shortcut                   | Action                                                            |
| -------------------------- | ----------------------------------------------------------------- |
| `Cmd / Ctrl + Shift + F`   | Activate / collapse toolbar and toggle **Pick Mode**              |
| `Enter` (in popover)       | Save current **Pin** and stay in **Pick Mode** to pick the next   |
| `Shift + Enter`            | Insert newline inside a **Pin** note                              |
| `S` / `Cmd / Ctrl + Enter` | Save active note and push all pending **Pin**s as a **Cue**       |
| `P` (when active)          | Pause / resume **Pick Mode**                                      |
| `A` / `1-5` (when active)  | Switch **Agent Target**                                           |
| `R` (when active)          | Reset current **Agent Target** session (start fresh on next Cue)  |
| `C` (when active)          | Copy pending **Cue** as structured Markdown                       |
| `X` (when active)          | Clear all pending **Pin**s                                        |
| `H` (when active)          | Hide / show **Pin**s on the page                                  |
| `Esc`                      | Close active popover (discarding empty draft) or collapse toolbar |

## Supported Agent Targets

| Agent Target | CLI            | Auto-approve invocation (`Continue` adds `--continue` / `resume --last`) |
| ------------ | -------------- | ------------------------------------------------------------------------ |
| Antigravity  | `agy`          | `agy --dangerously-skip-permissions -p <prompt>`                         |
| Claude Code  | `claude`       | `claude --dangerously-skip-permissions -p <prompt>`                      |
| Cursor Agent | `cursor-agent` | `cursor-agent --yolo -p <prompt>`                                        |
| OpenAI Codex | `codex`        | `codex exec --dangerously-bypass-approvals-and-sandbox <prompt>`         |
| Pi           | `pi`           | `pi --approve -p -- <prompt>`                                            |

## Design Principles

- **Push, not Pull** — Submitting a **Cue** triggers the selected CLI immediately in a serial FIFO queue with live SSE status in the browser capsule.
- **Framework-agnostic** — Zero-dependency Shadow DOM Web Component (`client.js`) with opportunistic source/component hints (React Fiber, Vue, Svelte, Astro, Vite inspector `data-*` attributes).
- **Safe Rollback** — Pending **Pin**s clear on send for clean HMR reloads, and automatically restore onto the page if a CLI run fails.

## Development

Requires Node.js `>= 22` and [`mise`](https://mise.jdx.dev/) (provisions `bun` via [`mise.toml`](./mise.toml)).

```bash
# Install workspace dependencies and build all targets
mise run setup

# Start core dev environment (cli, extension, web)
mise run dev

# Start unified playground examples server (/html, /vite-react/)
mise run example:dev

# Build all packages/apps/examples and run the test suite
mise run check
```

### Workspace Targets

| Workspace            | Description                                              | Dev Command              | Port    |
| -------------------- | -------------------------------------------------------- | ------------------------ | ------- |
| `packages/agentcue`  | CLI, local HTTP/SSE bridge, Vite plugin, and overlay     | `mise run cli:dev`       | `:4318` |
| `packages/extension` | Manifest V3 browser extension (unpacked + `.zip` bundle) | `mise run extension:dev` | —       |
| `apps/web`           | Official showcase and interactive documentation          | `mise run web:dev`       | `:4319` |
| `examples/`          | Unified playground server (`/html`, `/vite-react/`)      | `mise run example:dev`   | `:4320` |

Other workspace tasks: `mise run build`, `mise run test`, and `mise run clean`.

## License

MIT
