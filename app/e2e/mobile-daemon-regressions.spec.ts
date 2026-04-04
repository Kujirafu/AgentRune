import { test, expect } from "@playwright/test"
import { resolve } from "node:path"

const TMP_DIR = resolve(process.cwd(), "../tmp")

test.describe("Mobile daemon regressions", () => {
  test("default theme follows system color scheme", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem("agentrune_theme")
    })

    await page.emulateMedia({ colorScheme: "dark" })
    await page.goto("/?dev")
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true)

    await page.emulateMedia({ colorScheme: "light" })
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(false)
  })

  test("projects API can create and delete a project", async ({ request }) => {
    const name = `E2E Project ${Date.now()}`

    const createRes = await request.post("/api/projects", {
      data: { name, cwd: TMP_DIR },
    })
    expect(createRes.ok()).toBeTruthy()
    const created = await createRes.json()
    expect(created.name).toBe(name)
    expect(created.cwd).toBe(TMP_DIR)

    const listRes = await request.get("/api/projects")
    expect(listRes.ok()).toBeTruthy()
    const projects = await listRes.json()
    expect(projects.some((project: { id: string }) => project.id === created.id)).toBeTruthy()

    const deleteRes = await request.delete(`/api/projects/${created.id}`)
    expect(deleteRes.ok()).toBeTruthy()
  })

  test("mkdir API creates folders that browse can list", async ({ request }) => {
    const folderName = `e2e-mkdir-${Date.now()}`

    const mkdirRes = await request.post("/api/mkdir", {
      data: { parentPath: TMP_DIR, name: folderName },
    })
    expect(mkdirRes.ok()).toBeTruthy()
    const mkdirData = await mkdirRes.json()
    expect(mkdirData.path.endsWith(folderName)).toBeTruthy()

    const browseRes = await request.get(`/api/browse?path=${encodeURIComponent(TMP_DIR)}`)
    expect(browseRes.ok()).toBeTruthy()
    const browseData = await browseRes.json()
    expect(browseData.entries.some((entry: { name: string; isDir: boolean }) => entry.name === folderName && entry.isDir)).toBeTruthy()
  })
})
