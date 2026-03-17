import { lstatSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"

export function assertSafeStatePath(path: string): void {
  try {
    if (lstatSync(path).isSymbolicLink()) {
      throw new Error(`Refusing symlink state path: ${path}`)
    }
  } catch (err: any) {
    if (err?.code === "ENOENT") return
    throw err
  }
}

export function openStateFileForAppend(path: string): number {
  assertSafeStatePath(path)
  return openSync(path, "a")
}

export function readStateFile(path: string): string {
  assertSafeStatePath(path)
  return readFileSync(path, "utf-8")
}

export function writeStateFile(path: string, content: string): void {
  assertSafeStatePath(path)
  writeFileSync(path, content)
}

export function unlinkStateFile(path: string): void {
  try {
    assertSafeStatePath(path)
    unlinkSync(path)
  } catch (err: any) {
    if (err?.code !== "ENOENT") throw err
  }
}
