import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("../shared/config.js", () => ({
  loadConfig: () => ({
    vaultPath: "C:/vault",
    keyVaultPath: "C:/vault/AgentLore/金鑰庫",
  }),
}))

vi.mock("./vault-keys.js", () => ({
  loadNamedVaultSecrets: vi.fn(),
}))

import { loadNamedVaultSecrets } from "./vault-keys.js"
import { publishSocialPost } from "./social-publisher.js"

describe("social-publisher", () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("rejects empty text", async () => {
    await expect(publishSocialPost({ platform: "threads", text: "   " })).resolves.toEqual({
      success: false,
      platform: "threads",
      error: "Post text is empty",
    })
  })

  it("rejects Threads posts longer than 500 chars", async () => {
    await expect(publishSocialPost({ platform: "threads", text: "a".repeat(501) })).resolves.toEqual({
      success: false,
      platform: "threads",
      error: "Threads post exceeds 500 characters",
    })
  })

  it("fails cleanly when Threads credentials are unavailable", async () => {
    vi.mocked(loadNamedVaultSecrets).mockReturnValue({})

    await expect(publishSocialPost({ platform: "threads", text: "hello world" })).resolves.toEqual({
      success: false,
      platform: "threads",
      error: "Threads credentials not available in key vault",
    })
  })

  it("publishes Threads posts through the Graph API", async () => {
    vi.useFakeTimers()
    vi.mocked(loadNamedVaultSecrets).mockReturnValue({
      THREADS_USER_ID: "12345678901234567",
      THREADS_ACCESS_TOKEN: "threads-access-token",
    })

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "container-123" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "post-456" }),
      })

    vi.stubGlobal("fetch", fetchMock)

    const publishPromise = publishSocialPost({
      platform: "threads",
      text: "Approved post text",
    })

    await vi.runAllTimersAsync()

    await expect(publishPromise).resolves.toEqual({
      success: true,
      platform: "threads",
      postId: "post-456",
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://graph.threads.net/v1.0/12345678901234567/threads")
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://graph.threads.net/v1.0/12345678901234567/threads_publish")
  })
})

