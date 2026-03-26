import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { Dashboard, type DashboardProps } from "./Dashboard"
import { LocaleProvider } from "../lib/i18n/index.js"
import type { Project, AppSession, AgentEvent } from "../types"

// Mock lazy-loaded overlays
vi.mock("./PlanPanel", () => ({ PlanPanel: () => <div data-testid="plan-panel" /> }))
vi.mock("./AutomationSheet", () => ({ AutomationSheet: () => <div data-testid="automation-sheet" /> }))
vi.mock("./FireCrewSheet", () => ({ __esModule: true, default: () => <div data-testid="fire-crew-sheet" /> }))

const mockProjects: Project[] = [
  { id: "p1", name: "Project Alpha", cwd: "/alpha" },
  { id: "p2", name: "Project Beta", cwd: "/beta" },
]

const mockSessions: AppSession[] = [
  { id: "s1", projectId: "p1", agentId: "claude" },
  { id: "s2", projectId: "p1", agentId: "codex" },
]

function makeEvents(): Map<string, AgentEvent[]> {
  const map = new Map<string, AgentEvent[]>()
  map.set("s1", [{
    id: "e1", timestamp: Date.now(), type: "error", status: "failed",
    title: "Build failed: missing module",
  }])
  map.set("s2", [{
    id: "e2", timestamp: Date.now(), type: "command_run", status: "in_progress",
    title: "npm run test",
  }])
  return map
}

function renderDashboard(overrides?: Partial<DashboardProps>) {
  const props: DashboardProps = {
    projects: mockProjects,
    activeSessions: mockSessions,
    sessionEvents: makeEvents(),
    send: vi.fn(() => true),
    on: vi.fn(() => () => {}),
    sessionToken: "test-token",
    wsConnected: true,
    apiBase: "",
    theme: "dark",
    toggleTheme: vi.fn(),
    onSelectSession: vi.fn(),
    onNewSession: vi.fn(),
    onLaunch: vi.fn(),
    onOpenBuilder: vi.fn(),
    pendingPhaseGate: null,
    pendingReauthQueue: [],
    onPhaseGateRespond: vi.fn(),
    onReauth: vi.fn(),
    onKillSession: vi.fn(async () => {}),
    onNewProject: vi.fn(async () => {}),
    onDeleteProject: vi.fn(async () => {}),
    ...overrides,
  }
  return render(
    <LocaleProvider><Dashboard {...props} /></LocaleProvider>
  )
}

describe("Dashboard — Command Center layout", () => {
  beforeEach(() => {
    localStorage.removeItem("agentrune_locale")
    localStorage.removeItem("agentrune_session_labels")
    localStorage.removeItem("agentrune_session_autolabels")
    localStorage.removeItem("agentrune_server")
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true, json: () => Promise.resolve([]),
    } as Response)
  })

  it("renders CommandCenter with sidebar and main area", async () => {
    renderDashboard()
    expect(await screen.findByText("AgentRune")).toBeInTheDocument()
    // sessions-view is the default active view
    expect(screen.getByTestId("sessions-view")).toBeInTheDocument()
    // input bar present with placeholder
    expect(screen.getByPlaceholderText(/command|指令/i)).toBeInTheDocument()
  })

  it("renders in light mode", async () => {
    renderDashboard({ theme: "light" })
    expect(await screen.findByText("AgentRune")).toBeInTheDocument()
  })

  it("shows connection indicator (green when connected)", async () => {
    const { container } = renderDashboard()
    await screen.findByText("AgentRune")
    // Brand green dot for connected state (#BDD1C6)
    const dot = container.querySelector('[style*="background:"]')
    expect(dot).toBeTruthy()
  })

  it("shows disconnected indicator (red)", async () => {
    const { container } = renderDashboard({ wsConnected: false })
    await screen.findByText("AgentRune")
    // Brand red dot for disconnected state (#FB8184)
    const dot = container.querySelector('[style*="background:"]')
    expect(dot).toBeTruthy()
  })

  it("does not auto-expand unrelated new sessions that appear from outside the desktop flow", async () => {
    const view = renderDashboard()
    await screen.findByText("AgentRune")
    expect(screen.queryByTitle("Events")).not.toBeInTheDocument()

    const externalSession: AppSession = {
      id: "s3",
      projectId: "p1",
      agentId: "codex",
      createdAt: Date.now(),
    }

    view.rerender(
      <LocaleProvider>
        <Dashboard
          projects={mockProjects}
          activeSessions={[...mockSessions, externalSession]}
          sessionEvents={makeEvents()}
          send={vi.fn(() => true)}
          on={vi.fn(() => () => {})}
          sessionToken="test-token"
          wsConnected={true}
          apiBase=""
          theme="dark"
          toggleTheme={vi.fn()}
          onSelectSession={vi.fn()}
          onNewSession={vi.fn()}
          onLaunch={vi.fn()}
          onOpenBuilder={vi.fn()}
          pendingPhaseGate={null}
          pendingReauthQueue={[]}
          onPhaseGateRespond={vi.fn()}
          onReauth={vi.fn()}
          onKillSession={vi.fn(async () => {})}
          onNewProject={vi.fn(async () => {})}
          onDeleteProject={vi.fn(async () => {})}
        />
      </LocaleProvider>,
    )

    expect(screen.queryByTitle("Events")).not.toBeInTheDocument()
  })
})
