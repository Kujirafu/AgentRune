import { afterEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const mockConfig = vi.hoisted(() => ({
  dir: "",
}))

vi.mock("../shared/config.js", () => ({
  getConfigDir: () => mockConfig.dir,
}))

import {
  buildRecentSocialPostPromptContext,
  clearSocialPublishCooldown,
  findDuplicateSocialPost,
  formatSocialPublishCooldown,
  getActiveSocialPublishCooldown,
  normalizeSocialPostText,
  rememberSocialPost,
  rememberSocialPublishCooldown,
} from "./social-dedup.js"

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
  mockConfig.dir = ""
})

describe("social-dedup", () => {
  it("normalizes formatting differences into the same content fingerprint", () => {
    expect(normalizeSocialPostText("AI 盲區：  太小心了！\nhttps://example.com/"))
      .toBe(normalizeSocialPostText("AI 盲區 太小心了 https://example.com"))
  })

  it("blocks duplicate posts with punctuation-only differences", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentrune-social-dedup-"))
    tempDirs.push(dir)
    mockConfig.dir = dir

    expect(rememberSocialPost({
      platform: "threads",
      text: "AI 盲區：大部分人用 AI 的方式都太小心了。",
      postId: "post-1",
      recordType: "Agent 視角",
      recordTitle: "AI 盲區",
      publishedAt: Date.UTC(2026, 2, 17, 1, 30),
    })).toMatchObject({
      success: true,
      stored: true,
    })

    expect(findDuplicateSocialPost({
      platform: "threads",
      text: "AI 盲區 大部分人用 AI 的方式都太小心了",
      now: Date.UTC(2026, 2, 18, 1, 30),
    })).toMatchObject({
      postId: "post-1",
      recordTitle: "AI 盲區",
    })
  })

  it("builds prompt context from recent published posts", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentrune-social-dedup-"))
    tempDirs.push(dir)
    mockConfig.dir = dir

    rememberSocialPost({
      platform: "threads",
      text: "第一篇 approved copy",
      postId: "post-1",
      recordType: "Agent 視角",
      recordTitle: "第一篇",
      publishedAt: Date.UTC(2026, 2, 17, 1, 0),
    })
    rememberSocialPost({
      platform: "threads",
      text: "第二篇 approved copy",
      postId: "post-2",
      recordType: "觀點文",
      recordTitle: "第二篇",
      publishedAt: Date.UTC(2026, 2, 17, 2, 0),
    })

    const context = buildRecentSocialPostPromptContext("threads")

    expect(context).toContain("[Recent Threads Posts]")
    expect(context).toContain("第二篇")
    expect(context).toContain("第一篇")
    expect(context).toContain("will block duplicate or trivially reformatted text")
  })

  it("reads legacy Moltbook history when checking duplicates", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentrune-social-dedup-"))
    tempDirs.push(dir)
    mockConfig.dir = dir

    writeFileSync(join(dir, "moltbook-history.json"), JSON.stringify({
      version: 1,
      items: [
        {
          action: "new_post",
          title: "Latency floors catch fake reviews",
          text: "Short approvals looked identical to no review, so we started measuring review duration.",
          post_id: "post-789",
          created_at: "2026-03-17T08:00:00.000Z",
          source: "legacy-script",
        },
      ],
    }, null, 2), "utf-8")

    expect(findDuplicateSocialPost({
      platform: "moltbook",
      title: "Latency floors catch fake reviews",
      text: "Short approvals looked identical to no review, so we started measuring review duration.",
      now: Date.UTC(2026, 2, 18, 8, 0),
    })).toMatchObject({
      postId: "post-789",
      title: "Latency floors catch fake reviews",
      source: "legacy-script",
    })
  })

  it("persists active social publish cooldowns across runs", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentrune-social-dedup-"))
    tempDirs.push(dir)
    mockConfig.dir = dir

    const stored = rememberSocialPublishCooldown({
      platform: "moltbook",
      reason: "API returned Retry-After backoff",
      cooldownMs: 15 * 60 * 1000,
      source: "moltbook-scheduler",
      error: "429: Too Many Requests",
      createdAt: Date.UTC(2026, 2, 17, 9, 0),
    })

    expect(stored).toMatchObject({
      success: true,
      stored: true,
      entry: {
        platform: "moltbook",
        reason: "API returned Retry-After backoff",
        source: "moltbook-scheduler",
      },
    })

    const active = getActiveSocialPublishCooldown("moltbook", Date.UTC(2026, 2, 17, 9, 5))
    expect(active).toMatchObject({
      platform: "moltbook",
      error: "429: Too Many Requests",
    })
    expect(formatSocialPublishCooldown(active!, Date.UTC(2026, 2, 17, 9, 5))).toContain("10m remaining")
  })

  it("clears cooldowns after a successful publish", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentrune-social-dedup-"))
    tempDirs.push(dir)
    mockConfig.dir = dir

    rememberSocialPublishCooldown({
      platform: "threads",
      reason: "API rate limit or cooldown detected",
      cooldownMs: 5 * 60 * 1000,
    })

    expect(getActiveSocialPublishCooldown("threads")).not.toBeNull()
    expect(clearSocialPublishCooldown("threads")).toEqual({
      success: true,
      cleared: true,
    })
    expect(getActiveSocialPublishCooldown("threads")).toBeNull()
  })
})
