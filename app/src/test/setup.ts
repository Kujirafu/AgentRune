import "@testing-library/jest-dom/vitest"
import { vi } from "vitest"

// Mock Capacitor plugins
vi.mock("@capacitor/app", () => ({ App: { addListener: vi.fn() } }))
vi.mock("@capacitor/status-bar", () => ({ StatusBar: { setStyle: vi.fn(), setOverlaysWebView: vi.fn() } }))
vi.mock("@capacitor/keyboard", () => ({ Keyboard: { addListener: vi.fn() } }))
vi.mock("@capacitor/clipboard", () => ({ Clipboard: { write: vi.fn() } }))
vi.mock("@capacitor/browser", () => ({ Browser: { open: vi.fn() } }))
vi.mock("@capacitor/splash-screen", () => ({ SplashScreen: { hide: vi.fn() } }))

// Mock fetch
global.fetch = vi.fn(() =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(null) } as Response)
)
