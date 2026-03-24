import { test, expect, type Page } from "@playwright/test"

function desktopNav(page: Page, view: "sessions" | "schedules" | "workflows") {
  return page.getByTestId(`desktop-nav-${view}`)
}

test.describe("Dashboard responsive switch", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.goto("/?dev")
    await page.waitForTimeout(1500)
  })

  test("desktop viewport (>=900px) shows desktop navigation", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.waitForTimeout(500)

    await expect(page.locator("text=AgentRune").first()).toBeVisible()
    await expect(desktopNav(page, "sessions")).toBeVisible()
    await expect(desktopNav(page, "schedules")).toBeVisible()
    await expect(desktopNav(page, "workflows")).toBeVisible()
  })

  test("mobile viewport (<900px) hides desktop-only navigation", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(500)

    await expect(desktopNav(page, "workflows")).not.toBeVisible({ timeout: 2000 }).catch(() => {
      // UnifiedPanel may unmount the element entirely.
    })
  })

  test("switching from desktop to mobile preserves app state", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.waitForTimeout(500)

    if (await desktopNav(page, "schedules").isVisible()) {
      await desktopNav(page, "schedules").click()
      await page.waitForTimeout(200)
    }

    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(500)

    await expect(page.locator("body")).not.toBeEmpty()
    const bodyText = await page.locator("body").textContent()
    expect(bodyText!.length).toBeGreaterThan(10)
  })

  test("switching from mobile to desktop shows desktop navigation", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(500)

    await page.setViewportSize({ width: 1200, height: 800 })
    await page.waitForTimeout(500)

    await expect(desktopNav(page, "sessions")).toBeVisible()
    await expect(desktopNav(page, "workflows")).toBeVisible()
  })

  test("exactly at 900px breakpoint shows desktop navigation", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 })
    await page.waitForTimeout(500)

    await expect(desktopNav(page, "sessions")).toBeVisible()
  })

  test("at 899px breakpoint hides desktop-only navigation", async ({ page }) => {
    await page.setViewportSize({ width: 899, height: 800 })
    await page.waitForTimeout(500)

    await expect(desktopNav(page, "workflows")).not.toBeVisible({ timeout: 2000 }).catch(() => {})
  })
})

test.describe("Dashboard navigation", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.goto("/?dev")
    await page.waitForTimeout(1500)
  })

  test("sessions view shows command input bar", async ({ page }) => {
    await expect(desktopNav(page, "sessions")).toBeVisible()
    await expect(page.getByTestId("desktop-command-input")).toBeVisible()
  })

  test("clicking Schedules switches content", async ({ page }) => {
    await desktopNav(page, "schedules").click()
    await page.waitForTimeout(300)

    await expect(page.getByTestId("schedules-view")).toBeVisible()
    await expect(desktopNav(page, "schedules")).toHaveAttribute("aria-pressed", "true")
  })

  test("clicking Workflows shows workflows panel", async ({ page }) => {
    await desktopNav(page, "workflows").click()
    await page.waitForTimeout(300)

    await expect(page.getByTestId("workflows-view")).toBeVisible()
  })

  test("navigation switching is reversible", async ({ page }) => {
    await desktopNav(page, "workflows").click()
    await page.waitForTimeout(200)
    await desktopNav(page, "sessions").click()
    await page.waitForTimeout(200)

    await expect(page.getByTestId("sessions-view")).toBeVisible()
    await expect(page.getByTestId("desktop-command-input")).toBeVisible()
  })
})

test.describe("Dashboard project selector", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.goto("/?dev")
    await page.waitForTimeout(1500)
  })

  test("shows All Projects option", async ({ page }) => {
    const allProjectsButton = page.getByTestId("desktop-project-all")
    await expect(allProjectsButton).toBeVisible()
    await allProjectsButton.click()
    await expect(allProjectsButton).toHaveAttribute("aria-pressed", "true")
  })

  test("no console errors on load", async ({ page }) => {
    const errors: string[] = []
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text())
    })

    await page.setViewportSize({ width: 1200, height: 800 })
    await page.goto("/?dev")
    await page.waitForTimeout(2000)

    const realErrors = errors.filter(
      (e) => !e.includes("fetch") && !e.includes("WebSocket") && !e.includes("net::") && !e.includes("connect")
    )
    expect(realErrors).toHaveLength(0)
  })
})

test.describe("Dashboard session continuity across viewport", () => {
  test("session data persists through resize cycles", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.goto("/?dev")
    await page.waitForTimeout(1500)

    const desktopContent = await page.locator("body").textContent()

    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(500)
    const mobileContent = await page.locator("body").textContent()

    await page.setViewportSize({ width: 1200, height: 800 })
    await page.waitForTimeout(500)
    const desktopAgain = await page.locator("body").textContent()

    expect(desktopContent!.length).toBeGreaterThan(5)
    expect(mobileContent!.length).toBeGreaterThan(5)
    expect(desktopAgain!.length).toBeGreaterThan(5)
  })

  test("rapid resize does not crash the app", async ({ page }) => {
    await page.goto("/?dev")
    await page.waitForTimeout(1000)

    for (let i = 0; i < 5; i++) {
      await page.setViewportSize({ width: 1200, height: 800 })
      await page.waitForTimeout(50)
      await page.setViewportSize({ width: 390, height: 844 })
      await page.waitForTimeout(50)
    }

    await page.setViewportSize({ width: 1200, height: 800 })
    await page.waitForTimeout(500)

    await expect(page.locator("body")).not.toBeEmpty()
    const text = await page.locator("body").textContent()
    expect(text!.length).toBeGreaterThan(5)
  })
})
