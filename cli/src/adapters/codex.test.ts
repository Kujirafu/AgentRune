import { describe, expect, it } from "vitest"
import { codexAdapter } from "./codex.js"

describe("codex adapter", () => {
  it("turns trust prompts into decision requests", () => {
    const events = codexAdapter.parse(
      "This workspace is untrusted.\nDo you trust this folder? [Y/n]",
      {
        agentId: "codex",
        projectId: "demo",
        buffer: "This workspace is untrusted.\nDo you trust this folder? [Y/n]",
        isIdle: false,
      },
    )

    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe("decision_request")
    expect(events[0]?.title).toBe("Trust workspace")
    expect(events[0]?.decision?.options.map((option) => option.input)).toEqual(["y\n", "n\n"])
  })
})
