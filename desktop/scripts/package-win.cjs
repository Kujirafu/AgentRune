const fs = require("node:fs/promises")
const path = require("node:path")
const { spawn } = require("node:child_process")

const projectDir = path.resolve(__dirname, "..")
const outputDirName = "release-build"
const outputDir = path.join(projectDir, outputDirName)
const releaseMirrorDir = path.join(projectDir, "release")

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function removeDir(targetPath, attempts = 6) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (!(await pathExists(targetPath))) return
    try {
      await fs.rm(targetPath, { recursive: true, force: true })
      return
    } catch (error) {
      if (attempt === attempts) throw error
      await sleep(attempt * 400)
    }
  }
}

function runBuilder() {
  const args = ["--win", `--config.directories.output=${outputDirName}`]
  const command = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "npm"
  const commandArgs =
    process.platform === "win32"
      ? ["/d", "/s", "/c", "npm", "exec", "electron-builder", "--", ...args]
      : ["exec", "electron-builder", "--", ...args]

  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: projectDir,
      stdio: "inherit",
      shell: false,
    })

    child.on("exit", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`electron-builder exited with code ${code}`))
    })
    child.on("error", reject)
  })
}

async function mirrorTopLevelArtifacts() {
  await fs.mkdir(releaseMirrorDir, { recursive: true })
  const entries = await fs.readdir(outputDir, { withFileTypes: true })
  const copied = []

  for (const entry of entries) {
    if (!entry.isFile()) continue
    const sourcePath = path.join(outputDir, entry.name)
    const targetPath = path.join(releaseMirrorDir, entry.name)
    await fs.copyFile(sourcePath, targetPath)
    copied.push(targetPath)
  }

  return copied
}

async function main() {
  console.log(`[package-win] Cleaning ${outputDir}`)
  await removeDir(outputDir)

  console.log(`[package-win] Building Windows installer into ${outputDirName}`)
  await runBuilder()

  const copied = await mirrorTopLevelArtifacts()
  console.log("[package-win] Mirrored release artifacts:")
  for (const file of copied) {
    console.log(`- ${file}`)
  }
}

main().catch((error) => {
  console.error(`[package-win] ${error?.message || error}`)
  process.exitCode = 1
})
