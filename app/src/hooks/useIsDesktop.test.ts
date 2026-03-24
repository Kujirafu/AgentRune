import { renderHook, act } from "@testing-library/react"
import { useIsDesktop } from "./useIsDesktop"
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest"

describe("useIsDesktop", () => {
  const originalInnerWidth = window.innerWidth
  let listeners: Array<(e: Event) => void> = []

  beforeEach(() => {
    listeners = []
    vi.spyOn(window, "addEventListener").mockImplementation((type, handler) => {
      if (type === "resize") listeners.push(handler as (e: Event) => void)
    })
    vi.spyOn(window, "removeEventListener").mockImplementation(() => {})
    // Ensure no Capacitor
    delete (window as any).Capacitor
  })

  afterEach(() => {
    Object.defineProperty(window, "innerWidth", { value: originalInnerWidth, writable: true })
    vi.restoreAllMocks()
  })

  it("returns true when width >= 900", () => {
    Object.defineProperty(window, "innerWidth", { value: 1200, writable: true })
    const { result } = renderHook(() => useIsDesktop())
    expect(result.current).toBe(true)
  })

  it("returns false when width < 900", () => {
    Object.defineProperty(window, "innerWidth", { value: 600, writable: true })
    const { result } = renderHook(() => useIsDesktop())
    expect(result.current).toBe(false)
  })

  it("returns false when Capacitor is present (native app)", () => {
    Object.defineProperty(window, "innerWidth", { value: 1200, writable: true })
    ;(window as any).Capacitor = { isNativePlatform: () => true }
    const { result } = renderHook(() => useIsDesktop())
    expect(result.current).toBe(false)
    delete (window as any).Capacitor
  })

  it("updates on resize after debounce", async () => {
    Object.defineProperty(window, "innerWidth", { value: 1200, writable: true })
    const { result } = renderHook(() => useIsDesktop())
    expect(result.current).toBe(true)

    // Simulate resize to mobile
    Object.defineProperty(window, "innerWidth", { value: 600, writable: true })
    act(() => {
      for (const listener of listeners) listener(new Event("resize"))
    })

    // Before debounce — still true
    expect(result.current).toBe(true)

    // After debounce
    await act(async () => {
      await new Promise(r => setTimeout(r, 250))
    })
    expect(result.current).toBe(false)
  })

  it("detects resize from mobile to desktop", async () => {
    Object.defineProperty(window, "innerWidth", { value: 600, writable: true })
    const { result } = renderHook(() => useIsDesktop())
    expect(result.current).toBe(false)

    // Resize to desktop
    Object.defineProperty(window, "innerWidth", { value: 1024, writable: true })
    act(() => {
      for (const listener of listeners) listener(new Event("resize"))
    })
    await act(async () => {
      await new Promise(r => setTimeout(r, 250))
    })
    expect(result.current).toBe(true)
  })
})
