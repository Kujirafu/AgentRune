import { describe, it, expect, beforeEach, vi } from "vitest"
import { renderWithProviders, screen, userEvent, waitFor } from "../test/test-utils"
import { FileBrowser } from "./FileBrowser"
import { authedFetch } from "../lib/storage"

vi.mock("../lib/storage", () => ({
  authedFetch: vi.fn(),
  buildApiUrl: (path: string) => path,
}))

vi.mock("./SpringOverlay", () => ({
  SpringOverlay: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

function mockResponse(ok: boolean, body: unknown): Response {
  return {
    ok,
    json: () => Promise.resolve(body),
  } as Response
}

describe("FileBrowser", () => {
  beforeEach(() => {
    vi.mocked(authedFetch).mockReset()
  })

  it("loads directories on open with same-origin API paths", async () => {
    vi.mocked(authedFetch).mockResolvedValueOnce(mockResponse(true, {
      path: "C:/Users/test/project",
      parent: "C:/Users/test",
      entries: [],
    }))

    renderWithProviders(
      <FileBrowser
        open
        onClose={vi.fn()}
        onSelectPath={vi.fn()}
        initialPath="C:/Users/test/project"
      />
    )

    await waitFor(() => {
      expect(authedFetch).toHaveBeenCalledWith(
        "/api/browse?path=C%3A%2FUsers%2Ftest%2Fproject",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      )
    })
    expect(screen.getByText("project")).toBeInTheDocument()
  })

  it("shows mkdir errors without dismissing the inline form", async () => {
    vi.mocked(authedFetch)
      .mockResolvedValueOnce(mockResponse(true, {
        path: "C:/Users/test/project",
        parent: "C:/Users/test",
        entries: [],
      }))
      .mockResolvedValueOnce(mockResponse(false, { error: "Folder already exists" }))

    renderWithProviders(
      <FileBrowser
        open
        onClose={vi.fn()}
        onSelectPath={vi.fn()}
        initialPath="C:/Users/test/project"
      />
    )

    await waitFor(() => expect(screen.getByText("project")).toBeInTheDocument())

    const user = userEvent.setup()
    await user.click(screen.getByText(/New Folder|新增資料夾/))

    const input = screen.getByRole("textbox")
    await user.type(input, "docs")
    await user.click(screen.getByText(/Create|建立/))

    await waitFor(() => expect(screen.getByText("Folder already exists")).toBeInTheDocument())
    expect(screen.getByDisplayValue("docs")).toBeInTheDocument()
  })
})
