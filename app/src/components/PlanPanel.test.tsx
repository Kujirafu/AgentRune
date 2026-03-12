import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderWithProviders, screen, userEvent, waitFor } from "../test/test-utils"
import { PlanPanel } from "./PlanPanel"

// Mock StandardsContent to avoid deep dependency tree
vi.mock("./StandardsPage", () => ({
  StandardsContent: () => <div data-testid="standards-content">Standards Mock</div>,
}))

// Mock getApiBase
vi.mock("../lib/storage", () => ({
  getApiBase: () => "",
}))

describe("PlanPanel", () => {
  beforeEach(() => {
    vi.mocked(global.fetch).mockReset()
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(null),
    } as Response)
  })

  // ── PRD Tab ──

  it("renders PRD onboarding when no data", async () => {
    renderWithProviders(<PlanPanel projectId="test-project" />)
    await waitFor(() => {
      expect(screen.getByText(/Plan before you build|先規劃/)).toBeInTheDocument()
    })
  })

  it("shows 3 onboarding steps", async () => {
    renderWithProviders(<PlanPanel projectId="test-project" />)
    await waitFor(() => {
      expect(screen.getByText(/You describe|你描述/)).toBeInTheDocument()
      expect(screen.getByText(/follow-up|追問/)).toBeInTheDocument()
      expect(screen.getByText(/auto-generated|自動產出/)).toBeInTheDocument()
    })
  })

  it("shows start button that opens input", async () => {
    renderWithProviders(<PlanPanel projectId="test-project" />)
    const user = userEvent.setup()

    await waitFor(() => {
      expect(screen.getByText(/Start a Plan|開始規劃/)).toBeInTheDocument()
    })

    await user.click(screen.getByText(/Start a Plan|開始規劃/))

    expect(screen.getByText(/New Plan|新計畫/)).toBeInTheDocument()
    expect(screen.getByRole("textbox")).toBeInTheDocument()
  })

  it("input area has back button to return to onboarding", async () => {
    renderWithProviders(<PlanPanel projectId="test-project" />)
    const user = userEvent.setup()

    await waitFor(() => {
      expect(screen.getByText(/Start a Plan|開始規劃/)).toBeInTheDocument()
    })

    await user.click(screen.getByText(/Start a Plan|開始規劃/))
    expect(screen.getByText(/New Plan|新計畫/)).toBeInTheDocument()

    // Click back arrow — the SVG polyline button before "New Plan"
    const newPlanLabel = screen.getByText(/New Plan|新計畫/)
    const row = newPlanLabel.parentElement!
    const backBtn = row.querySelector("button")!
    await user.click(backBtn)

    // Should be back to onboarding
    await waitFor(() => {
      expect(screen.getByText(/Plan before you build|先規劃/)).toBeInTheDocument()
    })
  })

  it("start planning button disabled when input empty", async () => {
    renderWithProviders(<PlanPanel projectId="test-project" />)
    const user = userEvent.setup()

    await waitFor(() => {
      expect(screen.getByText(/Start a Plan|開始規劃/)).toBeInTheDocument()
    })
    await user.click(screen.getByText(/Start a Plan|開始規劃/))

    const submitBtn = screen.getByText(/Start Planning|開始規劃/)
    expect(submitBtn).toBeDisabled()
  })

  it("calls send when start planning with text", async () => {
    const mockSend = vi.fn(() => true)
    renderWithProviders(<PlanPanel projectId="test-project" send={mockSend} />)
    const user = userEvent.setup()

    await waitFor(() => {
      expect(screen.getByText(/Start a Plan|開始規劃/)).toBeInTheDocument()
    })
    await user.click(screen.getByText(/Start a Plan|開始規劃/))

    const textarea = screen.getByRole("textbox")
    await user.type(textarea, "Add dark mode")

    const submitBtn = screen.getByText(/Start Planning|開始規劃/)
    expect(submitBtn).not.toBeDisabled()
    await user.click(submitBtn)

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ type: "input" })
    )
  })

  // ── Tab switching ──

  it("switches between PRD, Tasks, Standards tabs", async () => {
    renderWithProviders(<PlanPanel projectId="test-project" />)
    const user = userEvent.setup()

    await waitFor(() => {
      expect(screen.getByText("PRD")).toBeInTheDocument()
    })

    // Click Tasks tab
    await user.click(screen.getByText(/^Tasks/))
    expect(screen.getByText(/No tasks yet|還沒有/)).toBeInTheDocument()

    // Click Standards tab
    const stdTab = screen.getByText(/Standards|開發規範/)
    await user.click(stdTab)
    expect(screen.getByTestId("standards-content")).toBeInTheDocument()

    // Back to PRD
    await user.click(screen.getByText("PRD"))
    expect(screen.getByText(/Plan before you build|先規劃/)).toBeInTheDocument()
  })

  // ── Tasks Tab ──

  it("shows progressive empty state in Tasks tab", async () => {
    renderWithProviders(<PlanPanel projectId="test-project" />)
    const user = userEvent.setup()

    await waitFor(() => {
      expect(screen.getByText("PRD")).toBeInTheDocument()
    })

    await user.click(screen.getByText(/^Tasks/))

    // Should show 2 action buttons, not a textarea
    expect(screen.getByText(/AI Breakdown|AI 拆解/)).toBeInTheDocument()
    expect(screen.getByText(/Import JSON|匯入 JSON/)).toBeInTheDocument()
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
  })

  it("clicking AI Breakdown reveals textarea", async () => {
    renderWithProviders(<PlanPanel projectId="test-project" />)
    const user = userEvent.setup()

    await waitFor(() => {
      expect(screen.getByText("PRD")).toBeInTheDocument()
    })

    await user.click(screen.getByText(/^Tasks/))
    await user.click(screen.getByText(/AI Breakdown|AI 拆解/))

    expect(screen.getByRole("textbox")).toBeInTheDocument()
    expect(screen.getByText(/Generate Tasks|產生任務/)).toBeInTheDocument()
  })

  // ── PRD with data ──

  it("renders PRD content when data exists", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        projectId: "test",
        requirement: "test",
        tasks: [
          { id: 1, title: "Task One", status: "done", description: "desc" },
          { id: 2, title: "Task Two", status: "pending", description: "desc" },
        ],
        prd: {
          goal: "Build a test feature",
          decisions: [{ question: "Framework?", answer: "React" }],
          approaches: [],
          scope: { included: ["Unit tests"], excluded: ["E2E"] },
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    } as Response)

    renderWithProviders(<PlanPanel projectId="test-project" />)

    await waitFor(() => {
      expect(screen.getByText("Build a test feature")).toBeInTheDocument()
    })

    expect(screen.getByText("1/2")).toBeInTheDocument() // progress
    expect(screen.getByText("Q: Framework?")).toBeInTheDocument()
    expect(screen.getByText("A: React")).toBeInTheDocument()
    expect(screen.getByText("Unit tests")).toBeInTheDocument()
  })
})
