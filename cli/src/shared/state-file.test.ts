import { closeSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  assertSafeStatePath,
  openStateFileForAppend,
  readStateFile,
  unlinkStateFile,
  writeStateFile,
} from "./state-file.js"

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "state-file-test-"))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

function trySymlink(target: string, link: string): boolean {
  try {
    symlinkSync(target, link)
    return true
  } catch {
    return false
  }
}

describe("assertSafeStatePath", () => {
  it("does not throw for a non-existent path", () => {
    const p = join(tmpDir, "nonexistent.txt")
    expect(() => assertSafeStatePath(p)).not.toThrow()
  })

  it("does not throw for a regular file", () => {
    const p = join(tmpDir, "regular.txt")
    writeFileSync(p, "data")
    expect(() => assertSafeStatePath(p)).not.toThrow()
  })

  it("throws for a symlink", () => {
    const target = join(tmpDir, "target.txt")
    const link = join(tmpDir, "link.txt")
    writeFileSync(target, "data")
    if (!trySymlink(target, link)) return
    expect(() => assertSafeStatePath(link)).toThrow(`Refusing symlink state path: ${link}`)
  })
})

describe("readStateFile", () => {
  it("reads an existing file", () => {
    const p = join(tmpDir, "read.txt")
    writeFileSync(p, "hello world")
    expect(readStateFile(p)).toBe("hello world")
  })

  it("throws ENOENT for a missing file", () => {
    const p = join(tmpDir, "missing.txt")
    expect(() => readStateFile(p)).toThrow()
  })

  it("throws for a symlink", () => {
    const target = join(tmpDir, "target.txt")
    const link = join(tmpDir, "link.txt")
    writeFileSync(target, "data")
    if (!trySymlink(target, link)) return
    expect(() => readStateFile(link)).toThrow(`Refusing symlink state path: ${link}`)
  })
})

describe("writeStateFile", () => {
  it("creates a new file with the given content", () => {
    const p = join(tmpDir, "write.txt")
    writeStateFile(p, "written content")
    expect(readFileSync(p, "utf-8")).toBe("written content")
  })

  it("overwrites existing content", () => {
    const p = join(tmpDir, "overwrite.txt")
    writeFileSync(p, "old")
    writeStateFile(p, "new")
    expect(readFileSync(p, "utf-8")).toBe("new")
  })

  it("throws for a symlink", () => {
    const target = join(tmpDir, "target.txt")
    const link = join(tmpDir, "link.txt")
    writeFileSync(target, "data")
    if (!trySymlink(target, link)) return
    expect(() => writeStateFile(link, "new")).toThrow(`Refusing symlink state path: ${link}`)
  })
})

describe("openStateFileForAppend", () => {
  it("returns a file descriptor for a new file", () => {
    const p = join(tmpDir, "append-new.txt")
    const fd = openStateFileForAppend(p)
    expect(typeof fd).toBe("number")
    expect(fd).toBeGreaterThan(0)
    closeSync(fd)
  })

  it("returns a file descriptor for an existing file", () => {
    const p = join(tmpDir, "append-existing.txt")
    writeFileSync(p, "initial")
    const fd = openStateFileForAppend(p)
    expect(typeof fd).toBe("number")
    expect(fd).toBeGreaterThan(0)
    closeSync(fd)
  })

  it("throws for a symlink", () => {
    const target = join(tmpDir, "target.txt")
    const link = join(tmpDir, "link.txt")
    writeFileSync(target, "data")
    if (!trySymlink(target, link)) return
    expect(() => openStateFileForAppend(link)).toThrow(`Refusing symlink state path: ${link}`)
  })
})

describe("unlinkStateFile", () => {
  it("deletes an existing file", () => {
    const p = join(tmpDir, "delete.txt")
    writeFileSync(p, "to be deleted")
    unlinkStateFile(p)
    expect(() => readFileSync(p)).toThrow()
  })

  it("does not throw for a non-existent file", () => {
    const p = join(tmpDir, "nonexistent.txt")
    expect(() => unlinkStateFile(p)).not.toThrow()
  })

  it("throws for a symlink", () => {
    const target = join(tmpDir, "target.txt")
    const link = join(tmpDir, "link.txt")
    writeFileSync(target, "data")
    if (!trySymlink(target, link)) return
    expect(() => unlinkStateFile(link)).toThrow(`Refusing symlink state path: ${link}`)
  })
})
