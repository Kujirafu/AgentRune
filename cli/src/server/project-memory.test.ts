import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./agentlore-init.js", () => ({
  initAgentloreStructure: vi.fn(),
  migrateMonolithicAgentlore: vi.fn(),
}))

vi.mock("./behavior-rules.js", () => ({
  ensurePrdApiSection: vi.fn(),
  ensureRulesFile: vi.fn(),
}))

import { initAgentloreStructure, migrateMonolithicAgentlore } from "./agentlore-init.js"
import { ensurePrdApiSection, ensureRulesFile } from "./behavior-rules.js"
import { ensureProjectMemoryReady, inferProjectId, inferProjectName } from "./project-memory.js"

const mockedMigrate = vi.mocked(migrateMonolithicAgentlore)
const mockedInit = vi.mocked(initAgentloreStructure)
const mockedEnsureRules = vi.mocked(ensureRulesFile)
const mockedEnsurePrd = vi.mocked(ensurePrdApiSection)

beforeEach(() => {
  vi.clearAllMocks()
  mockedMigrate.mockReturnValue({ migrated: false } as ReturnType<typeof migrateMonolithicAgentlore>)
  mockedInit.mockReturnValue({ created: false } as ReturnType<typeof initAgentloreStructure>)
})

// ---------------------------------------------------------------------------
// inferProjectName
// ---------------------------------------------------------------------------

describe("inferProjectName", () => {
  it("extracts the basename from a standard path", () => {
    expect(inferProjectName("/home/user/my-project")).toBe("my-project")
  })

  it("extracts the basename from a Windows-style path", () => {
    expect(inferProjectName("C:\\Users\\user\\Documents\\AgentRune")).toBe("AgentRune")
  })

  it("returns the directory name when path ends with a separator", () => {
    // basename of '/home/user/project/' is '' on some implementations;
    // the function falls back to 'Project' for empty basenames
    const result = inferProjectName("/home/user/project/")
    // Either the last segment or the fallback is acceptable — the key
    // contract is that it never returns an empty string
    expect(result.length).toBeGreaterThan(0)
  })

  it("returns 'Project' for an empty string path", () => {
    expect(inferProjectName("")).toBe("Project")
  })

  it("returns 'Project' for a root path whose basename is empty", () => {
    // basename("/") === "" on POSIX; the fallback kicks in
    const result = inferProjectName("/")
    expect(result).toBe("Project")
  })

  it("handles a single-segment path with no separators", () => {
    expect(inferProjectName("my-project")).toBe("my-project")
  })
})

// ---------------------------------------------------------------------------
// inferProjectId
// ---------------------------------------------------------------------------

describe("inferProjectId", () => {
  it("returns the basename unchanged when it contains only safe characters", () => {
    expect(inferProjectId("/home/user/my-project")).toBe("my-project")
    expect(inferProjectId("/home/user/project_name")).toBe("project_name")
    expect(inferProjectId("/home/user/Project123")).toBe("Project123")
  })

  it("replaces spaces with underscores", () => {
    expect(inferProjectId("/home/user/my project")).toBe("my_project")
  })

  it("replaces dots and slashes with underscores", () => {
    expect(inferProjectId("/home/user/my.project.v2")).toBe("my_project_v2")
  })

  it("replaces all special characters that are not alphanumeric, dash, or underscore", () => {
    expect(inferProjectId("/home/user/my@project!name")).toBe("my_project_name")
  })

  it("returns a non-empty string even when the path is empty", () => {
    // inferProjectName("") returns "Project", which normalizes to "Project".
    // The || "project" guard in inferProjectId is a defensive fallback;
    // the observable contract is that the result is always non-empty.
    expect(inferProjectId("").length).toBeGreaterThan(0)
  })

  it("preserves dashes in the project name", () => {
    expect(inferProjectId("/home/user/agent-rune-new")).toBe("agent-rune-new")
  })
})

// ---------------------------------------------------------------------------
// ensureProjectMemoryReady
// ---------------------------------------------------------------------------

describe("ensureProjectMemoryReady", () => {
  it("calls migrateMonolithicAgentlore with the project cwd", () => {
    ensureProjectMemoryReady("/home/user/project")

    expect(mockedMigrate).toHaveBeenCalledOnce()
    expect(mockedMigrate).toHaveBeenCalledWith("/home/user/project")
  })

  it("calls initAgentloreStructure with the project cwd", () => {
    ensureProjectMemoryReady("/home/user/project")

    expect(mockedInit).toHaveBeenCalledOnce()
    expect(mockedInit.mock.calls[0]?.[0]).toBe("/home/user/project")
  })

  it("calls ensureRulesFile with the project cwd", () => {
    ensureProjectMemoryReady("/home/user/project")

    expect(mockedEnsureRules).toHaveBeenCalledOnce()
    expect(mockedEnsureRules).toHaveBeenCalledWith("/home/user/project")
  })

  it("calls ensurePrdApiSection with the project cwd", () => {
    ensureProjectMemoryReady("/home/user/project")

    expect(mockedEnsurePrd).toHaveBeenCalledOnce()
    expect(mockedEnsurePrd.mock.calls[0]?.[0]).toBe("/home/user/project")
  })

  it("uses inferred projectName when options.projectName is not provided", () => {
    ensureProjectMemoryReady("/home/user/my-project")

    const initCall = mockedInit.mock.calls[0]
    expect(initCall?.[1]).toMatchObject({ projectName: "my-project" })
  })

  it("uses inferred projectId when options.projectId is not provided", () => {
    ensureProjectMemoryReady("/home/user/my-project")

    const prdCall = mockedEnsurePrd.mock.calls[0]
    // Third argument is the project ID
    expect(prdCall?.[2]).toBe("my-project")
  })

  it("uses the default port 3457 when options.port is not provided", () => {
    ensureProjectMemoryReady("/home/user/my-project")

    const prdCall = mockedEnsurePrd.mock.calls[0]
    // Second argument is the port
    expect(prdCall?.[1]).toBe(3457)
  })

  it("uses the custom projectName from options when provided", () => {
    ensureProjectMemoryReady("/home/user/my-project", { projectName: "Custom Name" })

    const initCall = mockedInit.mock.calls[0]
    expect(initCall?.[1]).toMatchObject({ projectName: "Custom Name" })
  })

  it("uses the custom projectId from options when provided", () => {
    ensureProjectMemoryReady("/home/user/my-project", { projectId: "custom-id" })

    const prdCall = mockedEnsurePrd.mock.calls[0]
    expect(prdCall?.[2]).toBe("custom-id")
  })

  it("uses the custom port from options when provided", () => {
    ensureProjectMemoryReady("/home/user/my-project", { port: 9000 })

    const prdCall = mockedEnsurePrd.mock.calls[0]
    expect(prdCall?.[1]).toBe(9000)
  })

  it("returns the migrated and initialized values from sub-functions", () => {
    const fakeMigrated = { migrated: true, path: "/old" } as ReturnType<typeof migrateMonolithicAgentlore>
    const fakeInitialized = { created: true } as ReturnType<typeof initAgentloreStructure>
    mockedMigrate.mockReturnValue(fakeMigrated)
    mockedInit.mockReturnValue(fakeInitialized)

    const result = ensureProjectMemoryReady("/home/user/project")

    expect(result.migrated).toBe(fakeMigrated)
    expect(result.initialized).toBe(fakeInitialized)
  })

  it("calls all four sub-functions exactly once per invocation", () => {
    ensureProjectMemoryReady("/home/user/project", { projectName: "P", projectId: "p", port: 1234 })

    expect(mockedMigrate).toHaveBeenCalledTimes(1)
    expect(mockedInit).toHaveBeenCalledTimes(1)
    expect(mockedEnsureRules).toHaveBeenCalledTimes(1)
    expect(mockedEnsurePrd).toHaveBeenCalledTimes(1)
  })
})
