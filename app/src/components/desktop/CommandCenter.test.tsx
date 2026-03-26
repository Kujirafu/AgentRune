import { act, fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { CommandCenter, type CommandCenterProps } from "./CommandCenter"
import type { AgentEvent, AppSession, Project } from "../../types"
import type { SessionDecisionDigest } from "../../lib/session-summary"

vi.mock("../../lib/analytics", () => ({
  trackDesktopSessionCreate: vi.fn(),
  trackDesktopCommandSend: vi.fn(),
  trackDesktopToolView: vi.fn(),
  trackDesktopSessionExpand: vi.fn(),
  trackDesktopSessionRestart: vi.fn(),
  trackDesktopBypassToggle: vi.fn(),
  trackDesktopSessionKill: vi.fn(),
  trackDesktopNewProject: vi.fn(),
}))

const projects: Project[] = [
  { id: "p1", name: "Project One", cwd: "C:\\repo" },
]

const existingSession: AppSession = {
  id: "s1",
  projectId: "p1",
  agentId: "codex",
  createdAt: 1_700_000_000_000,
}

const existingDigest: SessionDecisionDigest = {
  sessionId: "s1",
  agentId: "codex",
  displayLabel: "Existing Codex",
  status: "working",
  summary: "Already running",
  nextAction: "Wait",
  updatedAt: 1_700_000_000_100,
  priority: 80,
  source: "progress",
  shouldResume: true,
}

function makeProps(overrides?: Partial<CommandCenterProps>): CommandCenterProps {
  return {
    projects,
    activeSessions: [existingSession],
    sessionEvents: new Map<string, AgentEvent[]>([["s1", []]]),
    digests: new Map<string, SessionDecisionDigest>([["s1", existingDigest]]),
    send: vi.fn(() => true),
    on: vi.fn(() => () => {}),
    sessionToken: "token",
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
    automations: [],
    autoResults: new Map(),
    autoLoading: false,
    autoToggle: vi.fn(async () => {}),
    autoRefresh: vi.fn(),
    onEditAutomation: vi.fn(),
    onNewAutomation: vi.fn(),
    onFireCrew: vi.fn(),
    selectedProjectId: null,
    onSelectProject: vi.fn(),
    onKillSession: vi.fn(async () => {}),
    onNewProject: vi.fn(async () => {}),
    onDeleteProject: vi.fn(async () => {}),
    t: (key: string) => key,
    locale: "zh-TW",
    ...overrides,
  }
}

function createEventBus() {
  const handlers = new Map<string, Set<(msg: Record<string, unknown>) => void>>()
  const on = vi.fn((type: string, handler: (msg: Record<string, unknown>) => void) => {
    const set = handlers.get(type) || new Set<(msg: Record<string, unknown>) => void>()
    set.add(handler)
    handlers.set(type, set)
    return () => {
      const current = handlers.get(type)
      current?.delete(handler)
    }
  })

  return {
    on,
    emit(type: string, msg: Record<string, unknown>) {
      handlers.get(type)?.forEach((handler) => handler(msg))
    },
  }
}

function armFreshSessionFromTargetMenu() {
  fireEvent.click(screen.getByRole("button", { name: /Auto/i }))
  fireEvent.click(screen.getByText("新增"))
}

describe("CommandCenter new-session routing", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("opens the session launcher from the plus button instead of silently hijacking the action", () => {
    const props = makeProps()
    const send = vi.mocked(props.send)

    render(<CommandCenter {...props} />)

    fireEvent.click(screen.getByTitle("New session (Ctrl+N)"))

    expect(props.onNewSession).toHaveBeenCalledTimes(1)
    expect(send).not.toHaveBeenCalled()
  })

  it("does not let a stale expandSessionId steal the next message after fresh attach is sent", () => {
    const props = makeProps()
    const send = vi.mocked(props.send)
    const { rerender } = render(<CommandCenter {...props} />)

    armFreshSessionFromTargetMenu()
    fireEvent.change(screen.getByTestId("desktop-command-input"), {
      target: { value: "Start a clean mobile scheduling fix session" },
    })
    fireEvent.keyDown(screen.getByTestId("desktop-command-input"), { key: "Enter" })

    rerender(<CommandCenter {...props} expandSessionId="s1" />)

    fireEvent.change(screen.getByTestId("desktop-command-input"), {
      target: { value: "Do not resume the old session" },
    })
    fireEvent.keyDown(screen.getByTestId("desktop-command-input"), { key: "Enter" })

    const newSessionId = (send.mock.calls[0]?.[0] as Record<string, unknown>).sessionId as string
    expect(send.mock.calls.filter(([msg]) =>
      (msg as Record<string, unknown>).type === "attach",
    )).toHaveLength(1)
    expect(send.mock.calls.some(([msg]) =>
      (msg as Record<string, unknown>).type === "session_input"
      && (msg as Record<string, unknown>).sessionId === "s1",
    )).toBe(false)
    expect(send.mock.calls.some(([msg]) =>
      (msg as Record<string, unknown>).type === "session_input"
      && (msg as Record<string, unknown>).sessionId === newSessionId
      && (msg as Record<string, unknown>).data === "Do not resume the old session",
    )).toBe(true)
  })

  it("keeps the fresh-session handshake alive until the new session appears in activeSessions", async () => {
    const bus = createEventBus()
    const props = makeProps({ on: bus.on })
    const send = vi.mocked(props.send)
    const { rerender } = render(<CommandCenter {...props} />)

    armFreshSessionFromTargetMenu()
    fireEvent.change(screen.getByTestId("desktop-command-input"), {
      target: { value: "Start a brand new Codex session" },
    })
    fireEvent.keyDown(screen.getByTestId("desktop-command-input"), { key: "Enter" })

    const newSessionId = (send.mock.calls[0]?.[0] as Record<string, unknown>).sessionId as string
    await act(async () => {
      bus.emit("attached", { sessionId: newSessionId, resumed: false })
    })

    rerender(<CommandCenter {...props} on={bus.on} expandSessionId="s1" />)

    fireEvent.change(screen.getByTestId("desktop-command-input"), {
      target: { value: "Still route this to the fresh session" },
    })
    fireEvent.keyDown(screen.getByTestId("desktop-command-input"), { key: "Enter" })

    expect(send.mock.calls.filter(([msg]) =>
      (msg as Record<string, unknown>).type === "attach",
    )).toHaveLength(1)
    expect(send.mock.calls.some(([msg]) =>
      (msg as Record<string, unknown>).type === "session_input"
      && (msg as Record<string, unknown>).sessionId === "s1",
    )).toBe(false)
    expect(send.mock.calls.some(([msg]) =>
      (msg as Record<string, unknown>).type === "session_input"
      && (msg as Record<string, unknown>).sessionId === newSessionId
      && (msg as Record<string, unknown>).data === "Still route this to the fresh session",
    )).toBe(true)

    const newSession: AppSession = {
      ...existingSession,
      id: newSessionId,
      createdAt: (existingSession.createdAt || 0) + 1,
    }
    const newDigest: SessionDecisionDigest = {
      ...existingDigest,
      sessionId: newSessionId,
      displayLabel: "Fresh Codex",
    }

    await act(async () => {
      rerender(
        <CommandCenter
          {...props}
          on={bus.on}
          activeSessions={[existingSession, newSession]}
          sessionEvents={new Map<string, AgentEvent[]>([
            ["s1", []],
            [newSessionId, []],
          ])}
          digests={new Map<string, SessionDecisionDigest>([
            ["s1", existingDigest],
            [newSessionId, newDigest],
          ])}
          expandSessionId={newSessionId}
        />,
      )
    })

    fireEvent.change(screen.getByTestId("desktop-command-input"), {
      target: { value: "Now continue inside the new session" },
    })
    fireEvent.keyDown(screen.getByTestId("desktop-command-input"), { key: "Enter" })

    expect(send.mock.calls.some(([msg]) =>
      (msg as Record<string, unknown>).type === "session_input"
      && (msg as Record<string, unknown>).sessionId === newSessionId
      && (msg as Record<string, unknown>).data === "Now continue inside the new session",
    )).toBe(true)
  })

  it("ignores unrelated attached events from other Codex sessions while a fresh session is pending", async () => {
    const bus = createEventBus()
    const props = makeProps({ on: bus.on })
    const send = vi.mocked(props.send)

    render(<CommandCenter {...props} />)

    armFreshSessionFromTargetMenu()
    fireEvent.change(screen.getByTestId("desktop-command-input"), {
      target: { value: "Start a clean AgentRune session" },
    })
    fireEvent.keyDown(screen.getByTestId("desktop-command-input"), { key: "Enter" })

    const newSessionId = (send.mock.calls[0]?.[0] as Record<string, unknown>).sessionId as string

    await act(async () => {
      bus.emit("attached", { sessionId: "s1", resumed: false })
    })

    fireEvent.change(screen.getByTestId("desktop-command-input"), {
      target: { value: "Stay on the fresh session" },
    })
    fireEvent.keyDown(screen.getByTestId("desktop-command-input"), { key: "Enter" })

    expect(send.mock.calls.some(([msg]) =>
      (msg as Record<string, unknown>).type === "session_input"
      && (msg as Record<string, unknown>).sessionId === "s1",
    )).toBe(false)
    expect(send.mock.calls.some(([msg]) =>
      (msg as Record<string, unknown>).type === "session_input"
      && (msg as Record<string, unknown>).sessionId === newSessionId
      && (msg as Record<string, unknown>).data === "Stay on the fresh session",
    )).toBe(true)
  })
})
