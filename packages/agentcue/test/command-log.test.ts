import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDispatcher } from "../src/server/dispatcher.ts";
import {
  COMMAND_LOG_LIMIT,
  COMMAND_LOG_MARK,
  createCommandLog,
} from "../src/server/command-log.ts";
import type { CuePayload, ServerEvent } from "../src/shared/types.ts";

const sampleCue = (): CuePayload => ({
  agent: "agy",
  continueSession: false,
  pageUrl: "http://localhost:3000/",
  pageTitle: "Page",
  pins: [
    {
      index: 1,
      note: "Round the button",
      context: {
        tagName: "button",
        selector: "button",
        breadcrumb: "body > button",
        outerHTML: "<button>Go</button>",
        textExcerpt: "Go",
        computedStyles: {},
        boundingBox: { x: 0, y: 0, width: 10, height: 10 },
      },
    },
  ],
});

describe("command log buffer", () => {
  it("appends short chunks and keeps the tail after the cap", () => {
    const log = createCommandLog();
    assert.deepEqual(log.push("hello"), { append: "hello" });
    assert.equal(log.push(""), null);

    const big = "x".repeat(COMMAND_LOG_LIMIT);
    const crossed = log.push(big);
    assert.equal(crossed?.replace?.startsWith(COMMAND_LOG_MARK), true);
    assert.equal(crossed?.replace?.length, COMMAND_LOG_LIMIT);
    assert.equal(log.text(), crossed?.replace);

    const quiet = log.push("y".repeat(100));
    assert.equal(quiet, null);
    assert.equal(log.text().endsWith("y".repeat(100)), true);
    assert.equal(log.text().startsWith(COMMAND_LOG_MARK), true);

    const flushed = log.push("z".repeat(4096));
    assert.equal(flushed?.replace, log.text());
    assert.equal(flushed?.replace?.endsWith("z".repeat(4096)), true);
  });
});

describe("dispatcher command log events", () => {
  it("streams log updates and attaches the transcript to the terminal event", async () => {
    const events: ServerEvent[] = [];
    const dispatcher = createDispatcher({
      cwd: "/tmp/workspace-test",
      agents: ["agy"],
      defaultAgent: "agy",
      executor: async (invocation) => {
        assert.deepEqual(invocation.command.args.slice(0, 1), [
          "--dangerously-skip-permissions",
        ]);
        invocation.onLog?.({ append: "partial\n" });
        invocation.onLog?.({ replace: "jetski: denied\n" });
        return {
          ok: false,
          exitCode: 1,
          error: "jetski: denied",
          log: "jetski: denied\n",
        };
      },
    });
    dispatcher.subscribe((event) => events.push(event));
    dispatcher.enqueue(sampleCue());
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.deepEqual(
      events.filter((event) => event.type === "cue:log"),
      [
        { type: "cue:log", cueId: events.find((e) => e.type === "cue:log")?.cueId, append: "partial\n", replace: undefined },
        { type: "cue:log", cueId: events.find((e) => e.type === "cue:log")?.cueId, append: undefined, replace: "jetski: denied\n" },
      ]
    );
    const error = events.find((event) => event.type === "cue:error");
    assert.equal(error?.type, "cue:error");
    if (error?.type === "cue:error") {
      assert.equal(error.error, "jetski: denied");
      assert.equal(error.log, "jetski: denied\n");
    }
  });
});
