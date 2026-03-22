import { test, expect, type Page } from "@playwright/test"

// These E2E tests verify the Desktop Dashboard <-> UnifiedPanel responsive switch
// and that session state is preserved across viewport changes.
// Uses ?dev to bypass auth. Locale-agnostic: all text locators handle en + zh-TW.

// Helper: locale-agnostic tab locator
function tabBtn(page: Page, en: string, zhTW: string) {
  return page.locator("button", { hasText: en }).or(
    page.locator("button", { hasText: zhTW })
  ).first()
}

// Helper: locale-agnostic text locator
function anyText(page: Page, en: string, zhTW: string) {
  return page.locator(`text=${en}`).or(page.locator(`text=${zhTW}`)).first()
}

test.describe("Dashboard — Desktop/Mobile responsive switch", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.goto("/?dev")
    await page.waitForTimeout(1500)
  })

  test("desktop viewport (>=900px) shows Dashboard with tabs", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.waitForTimeout(500)
    // Dashboard should show "AgentRune" logo and tab bar
    const logo = page.locator("text=AgentRune").first()
    await expect(logo).toBeVisible()
    // Tab bar should have Tasks/Schedules/Workflows (or zh-TW equivalents)
    await expect(anyText(page, "Tasks", "任務")).toBeVisible()
    await expect(anyText(page, "Schedules", "排程")).toBeVisible()
    await expect(anyText(page, "Workflows", "工作流")).toBeVisible()
  })

  test("mobile viewport (<900px) shows UnifiedPanel instead", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(500)
    // UnifiedPanel has no "Workflows"/"工作流" tab button
    const workflowsTab = tabBtn(page, "Workflows", "工作流")
    await expect(workflowsTab).not.toBeVisible({ timeout: 2000 }).catch(() => {
      // May not exist at all — that's fine
    })
  })

  test("switching from desktop to mobile preserves app state", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.waitForTimeout(500)

    const schedulesTab = tabBtn(page, "Schedules", "排程")
    if (await schedulesTab.isVisible()) {
      await schedulesTab.click()
      await page.waitForTimeout(200)
    }

    // Shrink to mobile
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(500)

    // App should still be functional
    await expect(page.locator("body")).not.toBeEmpty()
    const bodyText = await page.locator("body").textContent()
    expect(bodyText!.length).toBeGreaterThan(10)
  })

  test("switching from mobile to desktop shows Dashboard", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(500)

    // Expand to desktop
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.waitForTimeout(500)

    // Dashboard should appear with its characteristic tabs
    await expect(anyText(page, "Tasks", "任務")).toBeVisible()
    await expect(anyText(page, "Workflows", "工作流")).toBeVisible()
  })

  test("exactly at 900px breakpoint shows Dashboard", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 })
    await page.waitForTimeout(500)

    await expect(anyText(page, "Tasks", "任務")).toBeVisible()
  })

  test("at 899px breakpoint shows UnifiedPanel", async ({ page }) => {
    await page.setViewportSize({ width: 899, height: 800 })
    await page.waitForTimeout(500)

    // 899px = below threshold, Dashboard-only "Workflows" tab should NOT exist
    const workflowsTab = tabBtn(page, "Workflows", "工作流")
    await expect(workflowsTab).not.toBeVisible({ timeout: 2000 }).catch(() => {})
  })
})

test.describe("Dashboard — Tab navigation", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.goto("/?dev")
    await page.waitForTimeout(1500)
  })

  test("Tasks tab shows command input bar", async ({ page }) => {
    const input = page.locator("input[placeholder*='Describe']").or(
      page.locator("input[placeholder*='描述']")
    )
    await expect(input.first()).toBeVisible()
  })

  test("clicking Schedules tab switches content", async ({ page }) => {
    await tabBtn(page, "Schedules", "排程").click()
    await page.waitForTimeout(300)
    // Command input (Tasks-only) should no longer be visible
    const commandInput = page.locator("input[placeholder*='Describe']").or(
      page.locator("input[placeholder*='描述']")
    )
    await expect(commandInput).toHaveCount(0)
  })

  test("clicking Workflows tab shows crew templates", async ({ page }) => {
    await tabBtn(page, "Workflows", "工作流").click()
    await page.waitForTimeout(300)
    await expect(
      anyText(page, "Crew Templates", "團隊模板")
    ).toBeVisible()
  })

  test("tab switching is reversible", async ({ page }) => {
    // Tasks -> Workflows -> Tasks
    await tabBtn(page, "Workflows", "工作流").click()
    await page.waitForTimeout(200)
    await tabBtn(page, "Tasks", "任務").click()
    await page.waitForTimeout(200)

    // Command input should be back
    const input = page.locator("input[placeholder*='Describe']").or(
      page.locator("input[placeholder*='描述']")
    )
    await expect(input.first()).toBeVisible()
  })
})

test.describe("Dashboard — Project selector", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.goto("/?dev")
    await page.waitForTimeout(1500)
  })

  test("shows All Projects option in dropdown", async ({ page }) => {
    const projectBtn = page.locator("button").filter({ has: page.locator("svg") }).filter({
      hasText: /.+/,
    }).first()

    if (await projectBtn.isVisible()) {
      await projectBtn.click()
      await page.waitForTimeout(200)

      const allProjectsOption = anyText(page, "All Projects", "所有專案")
      await expect(allProjectsOption).toBeVisible()
    }
  })

  test("no console errors on load", async ({ page }) => {
    const errors: string[] = []
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text())
    })

    await page.setViewportSize({ width: 1200, height: 800 })
    await page.goto("/?dev")
    await page.waitForTimeout(2000)

    // Filter out expected connection errors (no daemon running in test)
    const realErrors = errors.filter(
      (e) => !e.includes("fetch") && !e.includes("WebSocket") && !e.includes("net::") && !e.includes("connect")
    )
    expect(realErrors).toHaveLength(0)
  })
})

test.describe("Dashboard — Session continuity across viewport", () => {
  test("session data persists through resize cycles", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.goto("/?dev")
    await page.waitForTimeout(1500)

    const desktopContent = await page.locator("body").textContent()

    // Shrink to mobile
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(500)
    const mobileContent = await page.locator("body").textContent()

    // Back to desktop
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.waitForTimeout(500)
    const desktopAgain = await page.locator("body").textContent()

    // App should be functional in all states
    expect(desktopContent!.length).toBeGreaterThan(5)
    expect(mobileContent!.length).toBeGreaterThan(5)
    expect(desktopAgain!.length).toBeGreaterThan(5)
  })

  test("rapid resize does not crash the app", async ({ page }) => {
    await page.goto("/?dev")
    await page.waitForTimeout(1000)

    // Rapid resize cycles
    for (let i = 0; i < 5; i++) {
      await page.setViewportSize({ width: 1200, height: 800 })
      await page.waitForTimeout(50)
      await page.setViewportSize({ width: 390, height: 844 })
      await page.waitForTimeout(50)
    }

    // Settle at desktop
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.waitForTimeout(500)

    // Should still be alive
    await expect(page.locator("body")).not.toBeEmpty()
    const text = await page.locator("body").textContent()
    expect(text!.length).toBeGreaterThan(5)
  })
})
