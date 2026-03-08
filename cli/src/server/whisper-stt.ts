// whisper-stt.ts
// Local speech-to-text using whisper.cpp binary.
// Binary + model are lazy-downloaded on first use to ~/.agentrune/whisper/

import { existsSync, mkdirSync, createWriteStream, unlinkSync, chmodSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { homedir, platform, arch, cpus } from "node:os"
import { spawn, execSync } from "node:child_process"
import { pipeline } from "node:stream/promises"
import { log } from "../shared/logger.js"

const WHISPER_DIR = join(homedir(), ".agentrune", "whisper")
const MODEL_NAME = "ggml-base.bin"   // ~150MB, good balance of speed/quality
const MODEL_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin"

// whisper.cpp release binaries
const WHISPER_VERSION = "1.8.3"
function getBinaryInfo(): { url: string; binName: string } {
  const os = platform()
  const a = arch()
  if (os === "win32") {
    return {
      url: `https://github.com/ggerganov/whisper.cpp/releases/download/v${WHISPER_VERSION}/whisper-bin-x64.zip`,
      binName: "whisper-cli.exe",
    }
  }
  if (os === "darwin") {
    return {
      url: `https://github.com/ggerganov/whisper.cpp/releases/download/v${WHISPER_VERSION}/whisper-bin-${a === "arm64" ? "arm64" : "x64"}.zip`,
      binName: "whisper-cli",
    }
  }
  // Linux
  return {
    url: `https://github.com/ggerganov/whisper.cpp/releases/download/v${WHISPER_VERSION}/whisper-bin-x64.zip`,
    binName: "whisper-cli",
  }
}

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

async function downloadFile(url: string, dest: string): Promise<void> {
  log.info(`Downloading ${url} ...`)
  const res = await fetch(url, { redirect: "follow" })
  if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status} ${url}`)
  const ws = createWriteStream(dest)
  await pipeline(res.body as any, ws)
  log.info(`Downloaded → ${dest}`)
}

async function unzip(zipPath: string, destDir: string): Promise<void> {
  const os = platform()
  return new Promise((resolve, reject) => {
    let proc
    if (os === "win32") {
      // Use PowerShell's Expand-Archive
      proc = spawn("powershell", [
        "-NoProfile", "-Command",
        `Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force`,
      ], { windowsHide: true })
    } else {
      proc = spawn("unzip", ["-o", zipPath, "-d", destDir])
    }
    let stderr = ""
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString() })
    proc.on("close", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`unzip failed (${code}): ${stderr}`))
    })
    proc.on("error", reject)
  })
}

export async function ensureWhisperBinary(): Promise<string> {
  ensureDir(WHISPER_DIR)
  const { url, binName } = getBinaryInfo()
  const binPath = join(WHISPER_DIR, binName)

  if (existsSync(binPath)) return binPath

  // Download and extract
  const zipPath = join(WHISPER_DIR, "whisper-bin.zip")
  await downloadFile(url, zipPath)
  await unzip(zipPath, WHISPER_DIR)
  try { unlinkSync(zipPath) } catch {}

  // On unix, ensure executable
  if (platform() !== "win32") {
    try { chmodSync(binPath, 0o755) } catch {}
  }

  if (!existsSync(binPath)) {
    // Binary is in a subdirectory (e.g. Release/) — move all files up to WHISPER_DIR
    const { readdirSync, statSync, renameSync, copyFileSync } = await import("node:fs")
    const findBinDir = (dir: string): string | null => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (entry === binName) return dir
        if (statSync(full).isDirectory()) {
          const found = findBinDir(full)
          if (found) return found
        }
      }
      return null
    }
    const foundDir = findBinDir(WHISPER_DIR)
    if (foundDir && foundDir !== WHISPER_DIR) {
      // Move all files (exe + DLLs) from subdirectory to WHISPER_DIR
      for (const f of readdirSync(foundDir)) {
        const src = join(foundDir, f)
        const dest = join(WHISPER_DIR, f)
        if (!statSync(src).isDirectory()) {
          try { renameSync(src, dest) } catch { copyFileSync(src, dest) }
        }
      }
      if (platform() !== "win32") try { chmodSync(binPath, 0o755) } catch {}
    }
  }

  if (!existsSync(binPath)) throw new Error(`whisper binary not found after extraction: ${binPath}`)
  return binPath
}

export async function ensureModel(): Promise<string> {
  ensureDir(WHISPER_DIR)
  const modelPath = join(WHISPER_DIR, MODEL_NAME)
  if (existsSync(modelPath)) return modelPath
  await downloadFile(MODEL_URL, modelPath)
  return modelPath
}

export interface TranscribeResult {
  text: string
  model: string
  duration_ms: number
}

export async function transcribeAudio(audioPath: string): Promise<TranscribeResult> {
  const [binPath, modelPath] = await Promise.all([
    ensureWhisperBinary(),
    ensureModel(),
  ])

  const start = Date.now()
  const cpuCount = Math.max(2, Math.min(8, cpus().length))
  return new Promise((resolve, reject) => {
    // whisper-cli outputs to stdout with --output-txt --no-prints
    const args = [
      "-m", modelPath,
      "-f", audioPath,
      "--language", "auto",
      "--no-timestamps",
      "--print-progress", "false",
      "--threads", String(cpuCount),
    ]

    const proc = spawn(binPath, args, { windowsHide: true })
    let stdout = ""
    let stderr = ""
    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString() })
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString() })
    proc.on("close", (code) => {
      const duration_ms = Date.now() - start
      if (code !== 0) {
        log.error(`whisper-cli exited ${code}: ${stderr}`)
        reject(new Error(`whisper-cli failed (${code}): ${stderr.slice(0, 200)}`))
        return
      }
      const text = stdout.trim()
      log.info(`Whisper transcribed ${audioPath} in ${duration_ms}ms: "${text.slice(0, 80)}..."`)
      resolve({ text, model: MODEL_NAME.replace(".bin", ""), duration_ms })
    })
    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn whisper-cli: ${err.message}`))
    })
  })
}

// Find ffmpeg binary — checks PATH, then common install locations
let _ffmpegPath: string | null = null
function findFfmpeg(): string {
  if (_ffmpegPath) return _ffmpegPath

  // Try PATH first
  try {
    execSync("ffmpeg -version", { stdio: "ignore" })
    _ffmpegPath = "ffmpeg"
    return _ffmpegPath
  } catch {}

  // Common Windows locations (winget, chocolatey, manual)
  if (platform() === "win32") {
    const candidates: string[] = []

    // Search winget packages directory for ffmpeg
    const wingetPkgs = join(homedir(), "AppData", "Local", "Microsoft", "WinGet", "Packages")
    if (existsSync(wingetPkgs)) {
      try {
        for (const pkg of readdirSync(wingetPkgs)) {
          if (pkg.toLowerCase().includes("ffmpeg")) {
            const pkgDir = join(wingetPkgs, pkg)
            const findExe = (dir: string, depth = 0): string | null => {
              if (depth > 3) return null
              try {
                for (const f of readdirSync(dir)) {
                  const full = join(dir, f)
                  if (f === "ffmpeg.exe") return full
                  if (depth < 3 && statSync(full).isDirectory()) {
                    const found = findExe(full, depth + 1)
                    if (found) return found
                  }
                }
              } catch {}
              return null
            }
            const found = findExe(pkgDir)
            if (found) candidates.push(found)
          }
        }
      } catch {}
    }

    // Other common locations
    candidates.push(
      join(homedir(), "AppData", "Local", "Microsoft", "WinGet", "Links", "ffmpeg.exe"),
      "C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe",
    )

    for (const c of candidates) {
      if (existsSync(c)) {
        log.info(`Found ffmpeg at: ${c}`)
        _ffmpegPath = c
        return c
      }
    }
  }

  throw new Error("ffmpeg not found. Install ffmpeg: winget install Gyan.FFmpeg")
}

// Convert webm/ogg to wav (whisper.cpp needs 16kHz mono WAV)
export async function convertToWav(inputPath: string, outputPath: string): Promise<void> {
  const ffmpegPath = findFfmpeg()
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      "-i", inputPath,
      "-ar", "16000",
      "-ac", "1",
      "-f", "wav",
      "-y", outputPath,
    ], { windowsHide: true })
    let stderr = ""
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString() })
    proc.on("close", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg conversion failed (${code}): ${stderr.slice(0, 200)}`))
    })
    proc.on("error", () => {
      reject(new Error("ffmpeg not found. Install ffmpeg: winget install Gyan.FFmpeg"))
    })
  })
}

// Check if whisper is ready (binary + model downloaded)
export function isWhisperReady(): boolean {
  const { binName } = getBinaryInfo()
  return existsSync(join(WHISPER_DIR, binName)) && existsSync(join(WHISPER_DIR, MODEL_NAME))
}

// Pre-download binary + model (called during setup or on demand)
export async function setupWhisper(): Promise<{ binPath: string; modelPath: string }> {
  const [binPath, modelPath] = await Promise.all([
    ensureWhisperBinary(),
    ensureModel(),
  ])
  return { binPath, modelPath }
}
