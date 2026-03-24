const { spawnSync } = require("node:child_process")
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs")
const { tmpdir } = require("node:os")
const { join, resolve } = require("node:path")

const repoRoot = resolve(__dirname, "..", "..")
const desktopDir = resolve(__dirname, "..")
const nodePtyPath = join(repoRoot, "node_modules", "node-pty")
const electronBinary = require("electron")
const electronRebuildBin = process.platform === "win32"
  ? join(repoRoot, "node_modules", ".bin", "electron-rebuild.cmd")
  : join(repoRoot, "node_modules", ".bin", "electron-rebuild")

function runNodePtySmokeTest() {
  const tempDir = mkdtempSync(join(tmpdir(), "agentrune-electron-pty-"))
  const smokeScript = join(tempDir, "smoke.js")
  writeFileSync(smokeScript, `
const { app } = require("electron");
const path = require("node:path");
app.whenReady().then(() => {
  try {
    require(${JSON.stringify(nodePtyPath)});
    console.log("node-pty-load-ok");
    app.exit(0);
  } catch (err) {
    console.error(err && err.stack ? err.stack : String(err));
    app.exit(1);
  }
});
`, "utf8")

  try {
    return spawnSync(electronBinary, [smokeScript], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 60_000,
      windowsHide: true,
    })
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

const smoke = runNodePtySmokeTest()
if (smoke.stdout) process.stdout.write(smoke.stdout)
if (smoke.stderr) process.stderr.write(smoke.stderr)

if (smoke.status === 0 && /node-pty-load-ok/.test(smoke.stdout || "")) {
  console.log("[rebuild-pty] node-pty prebuild already loads in Electron; skipping electron-rebuild.")
  process.exit(0)
}

console.log("[rebuild-pty] node-pty prebuild smoke test failed; running electron-rebuild...")
const rebuild = spawnSync(electronRebuildBin, ["-m", "../cli", "-o", "node-pty"], {
  cwd: desktopDir,
  stdio: "inherit",
  windowsHide: true,
})

process.exit(rebuild.status ?? 1)
