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

  it("requires a title for Moltbook posts", async () => {
    await expect(publishSocialPost({
      platform: "moltbook",
      title: "   ",
      text: "Body text",
    })).resolves.toEqual({
      success: false,
      platform: "moltbook",
      error: "Moltbook post title is empty",
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

  it("publishes Moltbook posts and answers verification challenges", async () => {
    vi.mocked(loadNamedVaultSecrets).mockReturnValue({
      MOLTBOOK_API_KEY: "moltbook-secret",
    })

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          post: {
            id: "post-789",
            verification: {
              verification_code: "verify-123",
              challenge_text: "what is seven plus five",
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      })

    vi.stubGlobal("fetch", fetchMock)

    await expect(publishSocialPost({
      platform: "moltbook",
      title: "Latency floors catch fake reviews",
      text: "Short approvals looked identical to no review, so we started measuring review duration.",
      submolt: "general",
    })).resolves.toEqual({
      success: true,
      platform: "moltbook",
      postId: "post-789",
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://www.moltbook.com/api/v1/posts")
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://www.moltbook.com/api/v1/verify")
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(JSON.stringify({
      verification_code: "verify-123",
      answer: "12",
    }))
  })
})
