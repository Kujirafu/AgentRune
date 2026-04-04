import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderWithProviders, screen, userEvent } from "../test/test-utils"
import { DEFAULT_SETTINGS } from "../types"
import { SettingsSheet } from "./SettingsSheet"

vi.mock("./SpringOverlay", () => ({
  SpringOverlay: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }),
  },
}))

vi.mock("@capacitor/browser", () => ({
  Browser: {
    open: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock("../lib/analytics", () => ({
  identifyUser: vi.fn(),
  trackLogin: vi.fn(),
}))

describe("SettingsSheet", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("lets Gemini users pick a preset model without typing", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()

    renderWithProviders(
      <SettingsSheet
        open
        settings={{ ...DEFAULT_SETTINGS }}
        agentId="gemini"
        onChange={onChange}
        onClose={vi.fn()}
      />,
    )

    await user.click(await screen.findByRole("button", { name: "Gemini 2.5 Pro" }))

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      geminiModel: "gemini-2.5-pro",
    }))
  })

  it("lets Cursor users pick a preset model without typing", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()

    renderWithProviders(
      <SettingsSheet
        open
        settings={{ ...DEFAULT_SETTINGS }}
        agentId="cursor"
        onChange={onChange}
        onClose={vi.fn()}
      />,
    )

    await user.click(await screen.findByRole("button", { name: "Claude 4 Sonnet" }))

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      cursorModel: "claude-4-sonnet-thinking",
    }))
  })
})
