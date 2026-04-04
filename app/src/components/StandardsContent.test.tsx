import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderWithProviders, screen, userEvent, waitFor } from "../test/test-utils"
import { StandardsContent } from "./StandardsPage"

vi.mock("../lib/storage", () => ({
  getApiBase: () => "",
  authedFetch: (...args: Parameters<typeof fetch>) => fetch(...args),
}))

const mockStandards = {
  categories: [
    {
      id: "coding-style",
      name: { en: "Coding Style", "zh-TW": "程式碼風格" },
      icon: "pen-line",
      description: { en: "Naming conventions and formatting rules", "zh-TW": "命名規範與格式規則" },
      builtin: true,
      rules: [
        { id: "naming-conventions", category: "coding-style", severity: "error", enabled: true, title: "Naming Conventions", description: "Use consistent naming" },
        { id: "formatting", category: "coding-style", severity: "warning", enabled: false, title: "Formatting", description: "Follow formatting rules" },
      ],
    },
    {
      id: "git-flow",
      name: { en: "Git Flow", "zh-TW": "Git 流程" },
      icon: "git-branch",
      description: { en: "Branch naming and commit rules", "zh-TW": "分支命名與 commit 規則" },
      builtin: true,
      rules: [
        { id: "branch-naming", category: "git-flow", severity: "error", enabled: true, title: "Branch Naming", description: "Use conventional branch names" },
      ],
    },
  ],
  complexFeatureTriggers: {
    enabled: true,
    requiredDocs: ["guide", "flow", "sequence"],
    defaultConditions: [
      { type: "file_count", threshold: 5, description: { en: "Touches 5+ files", "zh-TW": "涉及 5 個以上檔案" } },
    ],
  },
  source: "builtin",
}

describe("StandardsContent", () => {
  beforeEach(() => {
    vi.mocked(global.fetch).mockReset()
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockStandards),
    } as Response)
  })

  it("renders category list", async () => {
    renderWithProviders(<StandardsContent />)
    await waitFor(() => {
      expect(screen.getByText("Coding Style")).toBeInTheDocument()
      expect(screen.getByText("Git Flow")).toBeInTheDocument()
    })
  })

  it("shows rule count per category", async () => {
    renderWithProviders(<StandardsContent />)
    await waitFor(() => {
      // Coding Style: 1/2 enabled, Git Flow: 1/1 enabled
      expect(screen.getByText(/1\/2/)).toBeInTheDocument()
      expect(screen.getByText(/1\/1/)).toBeInTheDocument()
    })
  })

  it("shows info button on builtin categories", async () => {
    renderWithProviders(<StandardsContent />)
    await waitFor(() => {
      expect(screen.getByText("Coding Style")).toBeInTheDocument()
    })
    // Info buttons (SVG icons) should exist — one per builtin category
    const infoButtons = document.querySelectorAll("button")
    // At least the Validate button + 2 info buttons
    expect(infoButtons.length).toBeGreaterThanOrEqual(3)
  })

  it("expands info on click", async () => {
    renderWithProviders(<StandardsContent />)
    const user = userEvent.setup()

    await waitFor(() => {
      expect(screen.getByText("Coding Style")).toBeInTheDocument()
    })

    // Info buttons are the small buttons inside each category card row
    // Find all buttons, filter to the ones that are info buttons (not Validate)
    const allButtons = Array.from(document.querySelectorAll("button"))
    const infoBtns = allButtons.filter(b => {
      // Info buttons contain an SVG but no text content matching "Validate"
      return b.querySelector("svg") && !b.textContent?.includes("Validate") && !b.textContent?.includes("Add")
    })
    expect(infoBtns.length).toBeGreaterThanOrEqual(1)
    await user.click(infoBtns[0])

    await waitFor(() => {
      expect(screen.getByText("Naming conventions and formatting rules")).toBeInTheDocument()
    })
  })

  it("navigates into category detail on click", async () => {
    renderWithProviders(<StandardsContent />)
    const user = userEvent.setup()

    await waitFor(() => {
      expect(screen.getByText("Coding Style")).toBeInTheDocument()
    })

    await user.click(screen.getByText("Coding Style"))

    await waitFor(() => {
      expect(screen.getByText("Naming Conventions")).toBeInTheDocument()
      expect(screen.getByText("Formatting")).toBeInTheDocument()
    })
  })

  it("shows severity badges on rules", async () => {
    renderWithProviders(<StandardsContent />)
    const user = userEvent.setup()

    await waitFor(() => {
      expect(screen.getByText("Coding Style")).toBeInTheDocument()
    })

    await user.click(screen.getByText("Coding Style"))

    await waitFor(() => {
      expect(screen.getByText("error")).toBeInTheDocument()
      expect(screen.getByText("warning")).toBeInTheDocument()
    })
  })

  it("has back button in category detail", async () => {
    renderWithProviders(<StandardsContent />)
    const user = userEvent.setup()

    await waitFor(() => {
      expect(screen.getByText("Coding Style")).toBeInTheDocument()
    })

    await user.click(screen.getByText("Coding Style"))
    await waitFor(() => {
      expect(screen.getByText("Naming Conventions")).toBeInTheDocument()
    })

    // Find back button (chevron-left SVG button)
    const backBtns = document.querySelectorAll("button")
    await user.click(backBtns[0]) // First button should be back

    await waitFor(() => {
      expect(screen.getByText("Git Flow")).toBeInTheDocument()
    })
  })

  it("shows complex feature triggers section", async () => {
    renderWithProviders(<StandardsContent />)
    await waitFor(() => {
      expect(screen.getByText(/Complex Feature Docs/)).toBeInTheDocument()
      expect(screen.getByText(/Touches 5\+ files/)).toBeInTheDocument()
    })
  })

  it("shows validate button", async () => {
    renderWithProviders(<StandardsContent />)
    await waitFor(() => {
      expect(screen.getByText("Validate")).toBeInTheDocument()
    })
  })

  it("triggers validation on button click", async () => {
    const mockReport = {
      timestamp: Date.now(),
      passed: true,
      results: [{ ruleId: "test", category: "test", severity: "error", title: "Test Rule", passed: true, message: "OK" }],
      summary: { total: 1, passed: 1, failed: 0, errors: 0, warnings: 0 },
    }
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockStandards) } as Response)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockReport) } as Response)

    renderWithProviders(<StandardsContent />)
    const user = userEvent.setup()

    await waitFor(() => {
      expect(screen.getByText("Validate")).toBeInTheDocument()
    })

    await user.click(screen.getByText("Validate"))

    await waitFor(() => {
      // Validation report shows "Validation Report" header
      expect(screen.getByText("Validation Report")).toBeInTheDocument()
    })
  })
})
