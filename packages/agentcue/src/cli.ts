import { resolve } from "node:path";
import { startServer } from "./server/server.ts";
import { SUPPORTED_AGENTS, type AgentId } from "./shared/types.ts";

interface CliArgs {
  port: number;
  host: string;
  cwd: string;
  defaultAgent?: AgentId;
  help: boolean;
}

function parseCliArgs(argv: string[]): CliArgs {
  let port = Number(process.env.AGENTCUE_PORT) || 4318;
  let host = "127.0.0.1";
  let cwd = process.cwd();
  let defaultAgent: AgentId | undefined;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      help = true;
    } else if (arg === "-p" || arg === "--port") {
      port = Number(argv[++i]);
    } else if (arg.startsWith("--port=")) {
      port = Number(arg.split("=")[1]);
    } else if (arg === "--host") {
      host = argv[++i];
    } else if (arg === "-C" || arg === "--cwd") {
      cwd = resolve(argv[++i]);
    } else if (arg === "-a" || arg === "--agent") {
      const candidate = argv[++i] as AgentId;
      if (SUPPORTED_AGENTS.includes(candidate)) defaultAgent = candidate;
    } else if (!arg.startsWith("-")) {
      const normalized = arg === "cursor" ? "cursor-agent" : arg;
      if (SUPPORTED_AGENTS.includes(normalized as AgentId)) {
        defaultAgent = normalized as AgentId;
      }
    }
  }

  return { port, host, cwd, defaultAgent, help };
}

function printHelp() {
  console.log(`
agentcue — Pick DOM elements in the browser and push Cues directly to your Agent CLI.

Usage:
  agentcue [agent] [options]

Agents:
  agy | claude | cursor-agent | codex | pi

Options:
  -p, --port <port>    Local bridge port (default: 4318)
  -a, --agent <agent>  Default selected Agent Target
  -C, --cwd <dir>      Target workspace directory (default: current directory)
  --host <host>        Bind host (default: 127.0.0.1)
  -h, --help           Show this help message
`);
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  let running: Awaited<ReturnType<typeof startServer>> | undefined;
  let candidatePort = args.port;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      running = await startServer({
        port: candidatePort,
        host: args.host,
        cwd: args.cwd,
        defaultAgent: args.defaultAgent,
      });
      break;
    } catch (err) {
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        err.code === "EADDRINUSE"
      ) {
        candidatePort += 1;
        continue;
      }
      throw err;
    }
  }
  if (!running) {
    throw new Error(`Could not find an open port starting from ${args.port}`);
  }

  const state = running.dispatcher.getState();
  const agentList = SUPPORTED_AGENTS.map((a) =>
    state.agents.includes(a) ? `\x1b[32m✓ ${a}\x1b[0m` : `\x1b[90m✗ ${a}\x1b[0m`
  ).join("   ");

  const scriptTag = `<script src="${running.origin}/client.js"></script>`;
  const bookmarklet = `javascript:(()=>{const s=document.createElement('script');s.src='${running.origin}/client.js?t='+Date.now();document.head.appendChild(s);})()`;

  console.log(`
\x1b[1m\x1b[36m✦ agentcue\x1b[0m bridge listening on \x1b[1m${running.origin}\x1b[0m
  Workspace : ${state.cwd}
  Agents    : ${agentList}

\x1b[1m1) Try the built-in live playground:\x1b[0m
   ${running.origin}/demo

\x1b[1m2) Add to any local dev app (HTML / Vite / Next / Vue / Svelte):\x1b[0m
   ${scriptTag}

\x1b[1m3) Or run as a zero-config Bookmarklet URL:\x1b[0m
   ${bookmarklet}

\x1b[90mShortcuts: Cmd/Ctrl+Shift+F activate · Enter save Pin · S (or Cmd/Ctrl+Enter) send · C copy · X clear · H hide · Esc collapse\x1b[0m
`);

  const shutdown = () => {
    console.log("\nShutting down agentcue…");
    void running.close().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
