import { describe, it, expect, beforeEach } from "vitest"
import { AnsiParser, stripAnsi } from "./ansi-parser"

// ── stripAnsi ────────────────────────────────────────────────────

describe("stripAnsi", () => {
  it("removes SGR color/style escape sequences", () => {
    const input = "\x1b[31mRed text\x1b[0m"
    expect(stripAnsi(input)).toBe("Red text")
  })

  it("removes multiple ANSI sequences", () => {
    const input = "\x1b[1m\x1b[32mBold green\x1b[0m normal"
    expect(stripAnsi(input)).toBe("Bold green normal")
  })

  it("converts cursor position moves (H) to newlines", () => {
    const input = "Line1\x1b[5;1HLine2"
    expect(stripAnsi(input)).toBe("Line1\nLine2")
  })

  it("converts cursor direction moves (A/B/C/D) to spaces", () => {
    const input = "before\x1b[3Cafter"
    expect(stripAnsi(input)).toBe("before after")
  })

  it("removes OSC sequences (title-setting, etc.)", () => {
    const input = "\x1b]0;Terminal Title\x07actual content"
    expect(stripAnsi(input)).toBe("actual content")
  })

  it("removes save/restore cursor sequences", () => {
    const input = "\x1b7saved\x1b8restored"
    expect(stripAnsi(input)).toBe("savedrestored")
  })

  it("removes charset selection sequences", () => {
    const input = "\x1b(Bsome text"
    expect(stripAnsi(input)).toBe("some text")
  })

  it("handles input with no ANSI sequences unchanged", () => {
    const input = "plain text here"
    expect(stripAnsi(input)).toBe("plain text here")
  })

  it("handles empty string", () => {
    expect(stripAnsi("")).toBe("")
  })

  it("handles complex combined sequences", () => {
    const input = "\x1b[1m\x1b[36m● \x1b[0mRead(file.ts)\x1b[K"
    const result = stripAnsi(input)
    expect(result).toContain("Read(file.ts)")
    expect(result).not.toMatch(/\x1b/)
  })
})

// ── AnsiParser ───────────────────────────────────────────────────

describe("AnsiParser", () => {
  let parser: AnsiParser

  beforeEach(() => {
    parser = new AnsiParser()
  })

  // ── Tool block detection ─────────────────────────────────────

  describe("tool blocks", () => {
    it("detects Read tool blocks", () => {
      parser.feed("● Read(src/index.ts)")
      const blocks = parser.getBlocks()
      expect(blocks.length).toBeGreaterThanOrEqual(1)
      const toolBlock = blocks.find((b) => b.type === "tool")
      expect(toolBlock).toBeDefined()
      expect(toolBlock!.content).toContain("Read(src/index.ts)")
    })

    it("detects Write tool blocks", () => {
      parser.feed("● Write(output.ts)")
      const blocks = parser.getBlocks()
      const toolBlock = blocks.find((b) => b.type === "tool")
      expect(toolBlock).toBeDefined()
      expect(toolBlock!.content).toContain("Write(output.ts)")
    })

    it("detects Bash tool blocks", () => {
      parser.feed("● Bash(npm test)")
      const blocks = parser.getBlocks()
      const toolBlock = blocks.find((b) => b.type === "tool")
      expect(toolBlock).toBeDefined()
      expect(toolBlock!.content).toContain("Bash(npm test)")
    })

    it("detects Edit tool blocks", () => {
      parser.feed("● Edit(file.ts)")
      const blocks = parser.getBlocks()
      const toolBlock = blocks.find((b) => b.type === "tool")
      expect(toolBlock).toBeDefined()
    })

    it("detects Glob, Grep, Agent tool blocks", () => {
      parser.feed("● Glob(**/*.ts)\n● Grep(pattern)\n● Agent(sub-task)")
      const blocks = parser.getBlocks()
      const toolBlocks = blocks.filter((b) => b.type === "tool")
      expect(toolBlocks.length).toBe(3)
    })
  })

  // ── Response block detection ─────────────────────────────────

  describe("response blocks", () => {
    it("detects response blocks (bullet followed by non-tool text)", () => {
      parser.feed("● Here is the summary of changes")
      const blocks = parser.getBlocks()
      const response = blocks.find((b) => b.type === "response")
      expect(response).toBeDefined()
      expect(response!.content).toContain("Here is the summary of changes")
    })

    it("strips the leading bullet from response content", () => {
      parser.feed("● The file has been updated successfully.")
      const blocks = parser.getBlocks()
      const response = blocks.find((b) => b.type === "response")
      expect(response).toBeDefined()
      expect(response!.content).not.toMatch(/^●/)
    })

    it("accumulates multi-line response text", () => {
      parser.feed("● First line\nSecond line\nThird line")
      const blocks = parser.getBlocks()
      const response = blocks.find((b) => b.type === "response")
      expect(response).toBeDefined()
      expect(response!.content).toContain("First line")
      expect(response!.content).toContain("Second line")
      expect(response!.content).toContain("Third line")
    })
  })

  // ── Diff block detection ─────────────────────────────────────

  describe("diff blocks", () => {
    // NOTE: diff blocks are only flushed when a non-diff line follows,
    // so we append a response line to trigger the flush.

    it("detects +++ diff patterns", () => {
      parser.feed("+++ b/src/file.ts\n\u25cf Done.")
      const blocks = parser.getBlocks()
      const diffBlock = blocks.find((b) => b.type === "diff")
      expect(diffBlock).toBeDefined()
      expect(diffBlock!.content).toContain("+++ b/src/file.ts")
    })

    it("detects --- diff patterns", () => {
      parser.feed("--- a/src/file.ts\n\u25cf Done.")
      const blocks = parser.getBlocks()
      const diffBlock = blocks.find((b) => b.type === "diff")
      expect(diffBlock).toBeDefined()
      expect(diffBlock!.content).toContain("--- a/src/file.ts")
    })

    it("detects @@ hunk headers", () => {
      parser.feed("@@ -1,5 +1,7 @@\n\u25cf Done.")
      const blocks = parser.getBlocks()
      const diffBlock = blocks.find((b) => b.type === "diff")
      expect(diffBlock).toBeDefined()
      expect(diffBlock!.content).toContain("@@ -1,5 +1,7 @@")
    })

    it("accumulates consecutive diff lines into one block", () => {
      parser.feed("--- a/file.ts\n+++ b/file.ts\n@@ -1,3 +1,4 @@\n\u25cf Done.")
      const blocks = parser.getBlocks()
      const diffBlocks = blocks.filter((b) => b.type === "diff")
      expect(diffBlocks).toHaveLength(1)
      expect(diffBlocks[0].content).toContain("--- a/file.ts")
      expect(diffBlocks[0].content).toContain("+++ b/file.ts")
      expect(diffBlocks[0].content).toContain("@@ -1,3 +1,4 @@")
    })
  })

  // ── Code fence detection ─────────────────────────────────────

  describe("code fence blocks", () => {
    it("detects fenced code blocks", () => {
      parser.feed("```typescript\nconst x = 1\n```")
      const blocks = parser.getBlocks()
      const codeBlock = blocks.find((b) => b.type === "code")
      expect(codeBlock).toBeDefined()
      expect(codeBlock!.content).toContain("const x = 1")
    })

    it("includes the language tag in content", () => {
      parser.feed("```python\nprint('hello')\n```")
      const blocks = parser.getBlocks()
      const codeBlock = blocks.find((b) => b.type === "code")
      expect(codeBlock).toBeDefined()
      expect(codeBlock!.content).toContain("```python")
    })

    it("handles empty code blocks", () => {
      parser.feed("```\n```")
      const blocks = parser.getBlocks()
      const codeBlock = blocks.find((b) => b.type === "code")
      expect(codeBlock).toBeDefined()
    })
  })

  // ── Noise line skipping ──────────────────────────────────────

  describe("noise line skipping", () => {
    it("skips thinking status lines", () => {
      parser.feed("* Thinking")
      const blocks = parser.getBlocks()
      expect(blocks).toHaveLength(0)
    })

    it("skips PS prompt lines", () => {
      parser.feed("PS C:\\Users\\test> some command")
      const blocks = parser.getBlocks()
      expect(blocks).toHaveLength(0)
    })

    it("skips copyright lines", () => {
      parser.feed("Copyright (c) Microsoft Corporation.")
      const blocks = parser.getBlocks()
      expect(blocks).toHaveLength(0)
    })

    it("skips short lines (length <= 2)", () => {
      parser.feed("ab")
      const blocks = parser.getBlocks()
      expect(blocks).toHaveLength(0)
    })

    it("skips empty/whitespace-only lines", () => {
      parser.feed("   \n\n   ")
      const blocks = parser.getBlocks()
      expect(blocks).toHaveLength(0)
    })

    it("skips token count lines", () => {
      parser.feed("(2.5s \u00b7 \u21911,234 tokens)")
      const blocks = parser.getBlocks()
      expect(blocks).toHaveLength(0)
    })

    it("skips box-drawing lines", () => {
      parser.feed("\u251c\u2500\u2500 some tree line")
      const blocks = parser.getBlocks()
      expect(blocks).toHaveLength(0)
    })

    it("skips 'thought for Ns' lines", () => {
      parser.feed("thought for 12s")
      const blocks = parser.getBlocks()
      expect(blocks).toHaveLength(0)
    })

    it("skips separator lines (dashes/equals)", () => {
      parser.feed("────────────────")
      const blocks = parser.getBlocks()
      expect(blocks).toHaveLength(0)
    })

    it("skips tool-path noise lines (e.g. Read(C:\\...))", () => {
      parser.feed("Read(C:\\Users\\test\\file.ts)")
      const blocks = parser.getBlocks()
      expect(blocks).toHaveLength(0)
    })

    it("does NOT skip actual tool markers with bullet", () => {
      parser.feed("\u25cf Read(C:\\Users\\test\\file.ts)")
      const blocks = parser.getBlocks()
      expect(blocks.length).toBeGreaterThanOrEqual(1)
    })
  })

  // ── getBlocks ────────────────────────────────────────────────

  describe("getBlocks", () => {
    it("returns all parsed blocks", () => {
      parser.feed("● Read(file.ts)\n● This is a response.\n```\ncode\n```")
      const blocks = parser.getBlocks()
      expect(blocks.length).toBeGreaterThanOrEqual(2)
    })

    it("returns a copy (not a reference to internal state)", () => {
      parser.feed("● Some response text")
      const blocks1 = parser.getBlocks()
      const blocks2 = parser.getBlocks()
      expect(blocks1).not.toBe(blocks2)
      expect(blocks1).toEqual(blocks2)
    })
  })

  // ── getCodeBlocks (merging) ──────────────────────────────────

  describe("getCodeBlocks", () => {
    it("returns code and diff blocks", () => {
      parser.feed("```\nsome code\n```\n--- a/file.ts\n+++ b/file.ts")
      const codeBlocks = parser.getCodeBlocks()
      expect(codeBlocks.length).toBeGreaterThanOrEqual(1)
    })

    it("merges adjacent diff blocks with close timestamps", () => {
      // Feed two diff hunks in one call (same timestamp window)
      parser.feed("--- a/file.ts\n+++ b/file.ts")
      parser.feed("● Some response breaks the flow")
      parser.feed("--- a/other.ts\n+++ b/other.ts")

      const codeBlocks = parser.getCodeBlocks()
      // They should NOT be merged since there's a response in between
      const diffBlocks = codeBlocks.filter((b) => b.type === "diff")
      expect(diffBlocks.length).toBeGreaterThanOrEqual(1)
    })

    it("returns copies of blocks", () => {
      parser.feed("```\nx\n```")
      const a = parser.getCodeBlocks()
      const b = parser.getCodeBlocks()
      expect(a).toEqual(b)
      expect(a).not.toBe(b)
    })
  })

  // ── getUrlBlocks ─────────────────────────────────────────────

  describe("getUrlBlocks", () => {
    it("extracts URLs from response blocks", () => {
      parser.feed("● Check https://example.com/path for details")
      const urls = parser.getUrlBlocks()
      expect(urls.length).toBe(1)
      expect(urls[0].url).toBe("https://example.com/path")
    })

    it("provides surrounding context", () => {
      parser.feed("● Line before\nVisit https://example.com here\nLine after")
      const urls = parser.getUrlBlocks()
      expect(urls.length).toBe(1)
      expect(urls[0].context).toContain("Line before")
      expect(urls[0].context).toContain("https://example.com")
      expect(urls[0].context).toContain("Line after")
    })

    it("deduplicates URLs", () => {
      parser.feed("● See https://example.com and https://example.com again")
      const urls = parser.getUrlBlocks()
      expect(urls.length).toBe(1)
    })

    it("strips trailing punctuation from URLs", () => {
      parser.feed("● Visit https://example.com/page.")
      const urls = parser.getUrlBlocks()
      expect(urls[0].url).toBe("https://example.com/page")
    })

    it("extracts multiple distinct URLs", () => {
      parser.feed(
        "● See https://alpha.com and https://beta.com for more"
      )
      const urls = parser.getUrlBlocks()
      expect(urls.length).toBe(2)
      const urlStrings = urls.map((u) => u.url)
      expect(urlStrings).toContain("https://alpha.com")
      expect(urlStrings).toContain("https://beta.com")
    })

    it("returns empty array when no URLs present", () => {
      parser.feed("● No links here")
      const urls = parser.getUrlBlocks()
      expect(urls).toEqual([])
    })

    it("includes timestamp from the block", () => {
      parser.feed("● Link: https://example.com")
      const urls = parser.getUrlBlocks()
      expect(urls[0].timestamp).toBeGreaterThan(0)
    })
  })

  // ── clear ────────────────────────────────────────────────────

  describe("clear", () => {
    it("resets all state", () => {
      parser.feed("● Read(file.ts)\n● A response\n```\ncode\n```")
      expect(parser.getBlocks().length).toBeGreaterThan(0)

      parser.clear()
      expect(parser.getBlocks()).toEqual([])
      expect(parser.getCodeBlocks()).toEqual([])
      expect(parser.getUrlBlocks()).toEqual([])
    })

    it("allows fresh parsing after clear", () => {
      parser.feed("● Old data")
      parser.clear()
      parser.feed("● New data")
      const blocks = parser.getBlocks()
      expect(blocks.length).toBe(1)
      expect(blocks[0].content).toContain("New data")
    })
  })

  // ── block cap ────────────────────────────────────────────────

  describe("block cap", () => {
    it("caps blocks at 200", () => {
      // Feed 210 distinct tool lines, each creates one block
      const lines = Array.from(
        { length: 210 },
        (_, i) => `● Read(file-${i}.ts)`
      ).join("\n")
      parser.feed(lines)
      const blocks = parser.getBlocks()
      expect(blocks.length).toBeLessThanOrEqual(200)
    })
  })
})
