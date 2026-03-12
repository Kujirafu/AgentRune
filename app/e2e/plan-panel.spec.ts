import { test, expect } from "@playwright/test"

// E2E tests against dev server (port 5173) proxied to daemon (port 3457)

test.describe("Plan Panel - App Load", () => {
  test("app loads without crash", async ({ page }) => {
    await page.goto("/")
    await page.waitForTimeout(1000)
    await expect(page.locator("body")).toBeVisible()
    const html = await page.content()
    expect(html.length).toBeGreaterThan(100)
  })

  test("no console errors on load", async ({ page }) => {
    const errors: string[] = []
    page.on("console", msg => {
      if (msg.type() === "error") errors.push(msg.text())
    })
    await page.goto("/")
    await page.waitForTimeout(2000)
    const realErrors = errors.filter(e =>
      !e.includes("WebSocket") && !e.includes("ERR_CONNECTION") && !e.includes("net::ERR")
    )
    expect(realErrors).toHaveLength(0)
  })
})

// Task 7: PRD complete flow
test.describe("PRD Flow", () => {
  test("standards API returns data", async ({ request }) => {
    const res = await request.get("/api/standards")
    expect(res.ok()).toBeTruthy()
    const data = await res.json()
    expect(data.categories).toBeDefined()
    expect(data.categories.length).toBeGreaterThan(0)
  })

  test("tasks API returns PRD data", async ({ request }) => {
    const res = await request.get("/api/tasks/agentrune")
    expect(res.ok()).toBeTruthy()
    const data = await res.json()
    expect(data.prd).toBeDefined()
    expect(data.prd.goal).toBeTruthy()
    expect(data.prd.decisions.length).toBeGreaterThan(0)
    expect(data.tasks.length).toBeGreaterThan(0)
  })

  test("tasks API can save and retrieve PRD", async ({ request }) => {
    const testPrd = {
      prd: {
        goal: "E2E test goal",
        decisions: [{ question: "test?", answer: "yes" }],
        approaches: [],
        scope: { included: ["test"], excluded: [] },
      },
      tasks: [{ id: 1, title: "Test task", status: "pending", description: "test" }],
    }

    // Save
    const saveRes = await request.post("/api/tasks/e2e-test-project", { data: testPrd })
    expect(saveRes.ok()).toBeTruthy()

    // Retrieve
    const getRes = await request.get("/api/tasks/e2e-test-project")
    expect(getRes.ok()).toBeTruthy()
    const saved = await getRes.json()
    expect(saved.prd.goal).toBe("E2E test goal")
    expect(saved.tasks).toHaveLength(1)
  })
})

// Task 8: Tasks API flow
test.describe("Tasks Flow", () => {
  test("task status can be updated", async ({ request }) => {
    // First ensure test data exists
    await request.post("/api/tasks/e2e-test-project", {
      data: {
        tasks: [
          { id: 1, title: "Task A", status: "pending", description: "test" },
          { id: 2, title: "Task B", status: "pending", description: "test" },
        ],
      },
    })

    // Update status
    const patchRes = await request.patch("/api/tasks/e2e-test-project/1", {
      data: { status: "done" },
    })
    expect(patchRes.ok()).toBeTruthy()

    // Verify
    const getRes = await request.get("/api/tasks/e2e-test-project")
    const data = await getRes.json()
    const task1 = data.tasks.find((t: { id: number }) => t.id === 1)
    expect(task1.status).toBe("done")
  })
})

// Task 9: Standards API flow
test.describe("Standards Flow", () => {
  test("standards categories have rules", async ({ request }) => {
    const res = await request.get("/api/standards")
    const data = await res.json()

    for (const cat of data.categories) {
      expect(cat.id).toBeTruthy()
      expect(cat.name.en).toBeTruthy()
      expect(cat.rules).toBeDefined()
      expect(cat.rules.length).toBeGreaterThan(0)
    }
  })

  test("standards have 6 builtin categories", async ({ request }) => {
    const res = await request.get("/api/standards")
    const data = await res.json()
    const builtinIds = data.categories.map((c: { id: string }) => c.id)
    expect(builtinIds).toContain("coding-style")
    expect(builtinIds).toContain("packages")
    expect(builtinIds).toContain("code-review")
    expect(builtinIds).toContain("git-flow")
    expect(builtinIds).toContain("best-practices")
    expect(builtinIds).toContain("workflow")
  })

  test("standards validation endpoint works", async ({ request }) => {
    const res = await request.post("/api/standards/validate", { data: {} })
    expect(res.ok()).toBeTruthy()
    const report = await res.json()
    expect(report.summary).toBeDefined()
    expect(report.summary.total).toBeGreaterThan(0)
    expect(typeof report.passed).toBe("boolean")
  })

  test("complex feature triggers configured", async ({ request }) => {
    const res = await request.get("/api/standards")
    const data = await res.json()
    expect(data.complexFeatureTriggers).toBeDefined()
    expect(data.complexFeatureTriggers.enabled).toBe(true)
    expect(data.complexFeatureTriggers.defaultConditions.length).toBeGreaterThan(0)
  })
})
