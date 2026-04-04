const fs = require("node:fs/promises")
const path = require("node:path")

const rootDir = path.resolve(__dirname, "..")
const desktopPkg = require(path.join(rootDir, "desktop", "package.json"))
const version = desktopPkg.version
const releaseAssetDir = path.join(rootDir, ".release-assets")
const updaterBaseName = `AgentRune-Setup-${version}.exe`

const copyTargets = [
  {
    from: path.join(rootDir, "desktop", "release", `AgentRune Setup ${version}.exe`),
    to: path.join(releaseAssetDir, "agentrune-desktop.exe"),
  },
  {
    from: path.join(rootDir, "app", "android", "app", "build", "outputs", "apk", "release", "app-release.apk"),
    to: path.join(releaseAssetDir, "agentrune.apk"),
  },
  {
    from: path.join(rootDir, "app", "android", "app", "build", "outputs", "bundle", "release", "app-release.aab"),
    to: path.join(releaseAssetDir, "agentrune.aab"),
  },
  {
    from: path.join(rootDir, "desktop", "release", `AgentRune Setup ${version}.exe`),
    to: path.join(releaseAssetDir, updaterBaseName),
  },
  {
    from: path.join(rootDir, "desktop", "release", `AgentRune Setup ${version}.exe.blockmap`),
    to: path.join(releaseAssetDir, `${updaterBaseName}.blockmap`),
  },
  {
    from: path.join(rootDir, "desktop", "release", "latest.yml"),
    to: path.join(releaseAssetDir, "latest.yml"),
  },
  {
    from: path.join(rootDir, "desktop", "release", "builder-debug.yml"),
    to: path.join(releaseAssetDir, "builder-debug.yml"),
  },
]

async function ensureFileExists(filePath) {
  try {
    await fs.access(filePath)
  } catch {
    throw new Error(`Missing release artifact: ${filePath}`)
  }
}

async function main() {
  await fs.rm(releaseAssetDir, { recursive: true, force: true })
  await fs.mkdir(releaseAssetDir, { recursive: true })

  for (const target of copyTargets) {
    await ensureFileExists(target.from)
    await fs.copyFile(target.from, target.to)
    console.log(`[release-assets] ${path.basename(target.to)}`)
  }
}

main().catch((error) => {
  console.error(`[release-assets] ${error?.message || error}`)
  process.exitCode = 1
})
