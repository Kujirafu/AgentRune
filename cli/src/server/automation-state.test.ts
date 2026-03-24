import { describe, expect, it } from "vitest"
import {
  computeAutomationBehaviorStateHash,
  computeAutomationLaunchStateHash,
  computeAutomationPromptStateHash,
  validateAutomationLaunchState,
} from "./automation-state.js"

describe("automation-state helpers", () => {
  it("produces stable hashes for equivalent config objects", () => {
    const left = computeAutomationBehaviorStateHash({
      prompt: "Ship report",
      locale: "zh-TW",
      schedule: { type: "daily", weekdays: [5, 1, 3] },
    })
    const right = computeAutomationBehaviorStateHash({
      schedule: { weekdays: [1, 3, 5], type: "daily" },
      locale: "zh-TW",
      prompt: "Ship report",
    })
    expect(left).toBe(right)
  })

  it("normalizes prompt file paths out of launch hashes", () => {
    const left = computeAutomationLaunchStateHash({
      bin: "claude",
      args: ["-p", "Read and follow all instructions in this file: C:\\tmp\\prompt_auto.txt"],
      fullPrompt: "hello",
    })
    const right = computeAutomationLaunchStateHash({
      bin: "claude",
      args: ["-p", "Read and follow all instructions in this file: D:\\other\\prompt_auto.txt"],
      fullPrompt: "hello",
    })
    expect(left).toBe(right)
  })

  it("detects when model or locale were dropped from runtime launch state", () => {
    const issues = validateAutomationLaunchState(
      {
        agentId: "codex",
        model: "gpt-5.4",
        locale: "zh-TW",
        skill: "search_docs",
      },
      {
        bin: "codex",
        args: ["--full-auto", "-q", "Read and follow all instructions in prompt.txt"],
        fullPrompt: "no locale and no skill here",
      },
    )
    expect(issues).toContain('Configured model "gpt-5.4" did not reach launch args')
    expect(issues).toContain('Configured locale "zh-TW" did not reach the runtime prompt')
    expect(issues).toContain('Configured skill "search_docs" did not reach the runtime prompt')
  })

  it("hashes prompt content independently", () => {
    expect(computeAutomationPromptStateHash("a")).not.toBe(computeAutomationPromptStateHash("b"))
  })
})
