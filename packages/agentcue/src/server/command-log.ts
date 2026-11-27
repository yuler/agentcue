export const COMMAND_LOG_LIMIT = 64 * 1024;
export const COMMAND_LOG_MARK = "[agentcue] earlier output truncated\n";
const REPLACE_EVERY = 4096;

export interface CommandLogEmit {
  append?: string;
  replace?: string;
}

export function createCommandLog() {
  let text = "";
  let truncated = false;
  let sinceReplace = 0;

  function capped(raw: string): string {
    if (raw.length <= COMMAND_LOG_LIMIT) return raw;
    const room = COMMAND_LOG_LIMIT - COMMAND_LOG_MARK.length;
    return COMMAND_LOG_MARK + raw.slice(-room);
  }

  return {
    push(chunk: string): CommandLogEmit | null {
      if (!chunk) return null;
      const base = truncated ? text.slice(COMMAND_LOG_MARK.length) : text;
      const combined = base + chunk;
      if (!truncated && combined.length <= COMMAND_LOG_LIMIT) {
        text = combined;
        return { append: chunk };
      }
      const crossed = !truncated;
      truncated = true;
      text = capped(combined);
      sinceReplace += chunk.length;
      if (crossed || sinceReplace >= REPLACE_EVERY) {
        sinceReplace = 0;
        return { replace: text };
      }
      return null;
    },
    text(): string {
      return text;
    },
  };
}

export function failureReason(
  log: string,
  bin: string,
  code: number | null
): string {
  const lines = log
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== COMMAND_LOG_MARK.trim());
  const tail = lines.slice(-3).join(" ");
  return tail || `${bin} exited with code ${code ?? "null"}`;
}
