import { render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DesktopSessionPanel } from "./DesktopSessionPanel"
import { DEFAULT_SETTINGS } from "../../types"

vi.mock("../../lib/storage", () => ({
  getSettings: vi.fn(() => DEFAULT_SETTINGS),
  getAutoSaveKeysEnabled: vi.fn(() => true),
  getAutoSaveKeysPath: vi.fn(() => "~/.agentrune/secrets"),
}))

describe("DesktopSessionPanel", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    })
  })

  it("requests events for active sessions without re-attaching them from the events panel", async () => {
    const send = vi.fn(() => true)
    const on = vi.fn(() => () => {})

    render(
      <DesktopSessionPanel
        session={{ id: "demo_123", projectId: "demo", agentId: "codex", status: "active" }}
        digest={undefined}
        events={[]}
        send={send}
        on={on}
        sessionToken="token"
        theme="dark"
        locale="zh-TW"
      />
    )

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send).toHaveBeenNthCalledWith(1, { type: "request_events", sessionId: "demo_123", agentId: "codex" })
  })

  it("keeps recoverable sessions on resume attach mode", async () => {
    const send = vi.fn(() => true)
    const on = vi.fn(() => () => {})

    render(
      <DesktopSessionPanel
        session={{ id: "demo_456", projectId: "demo", agentId: "claude", status: "recoverable" }}
        digest={undefined}
        events={[]}
        send={send}
        on={on}
        sessionToken="token"
        theme="dark"
        locale="zh-TW"
      />
    )

    await waitFor(() => expect(send).toHaveBeenCalledTimes(2))
    expect(send).toHaveBeenNthCalledWith(2, expect.objectContaining({
      type: "attach",
      sessionId: "demo_456",
      isAgentResume: true,
    }))
  })

  it("hides noisy Claude fallback response events while keeping the structured reply", () => {
    const send = vi.fn(() => true)
    const on = vi.fn(() => () => {})

    render(
      <DesktopSessionPanel
        session={{ id: "demo_789", projectId: "demo", agentId: "claude", status: "active" }}
        digest={undefined}
        events={[
          {
            id: "evt-noisy",
            timestamp: 100,
            type: "info",
            status: "completed",
            title: "Claude responded (detailed)",
            detail: "Vibing... thinking with max effort\ncurrent: 2.1.84 latest: 2.1.84",
          },
          {
            id: "evt-clean",
            timestamp: 101,
            type: "response",
            status: "completed",
            title: "已載入安全審查技能",
            detail: "現在啟動 Step 1 的兩個並行審計分支。",
          },
        ]}
        send={send}
        on={on}
        sessionToken="token"
        theme="dark"
        locale="zh-TW"
      />
    )

    expect(screen.queryByText(/Claude responded/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Vibing/i)).not.toBeInTheDocument()
    expect(screen.getByText("已載入安全審查技能")).toBeInTheDocument()
  })
})
