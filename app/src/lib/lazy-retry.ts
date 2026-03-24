import { lazy, type ComponentType } from "react"

/**
 * Wraps React.lazy with automatic page reload on chunk loading failure.
 * After a Vite rebuild, cached JS may reference stale chunk hashes (e.g.
 * AutomationSheet-BAK880mL.js no longer exists). This helper catches the
 * import error and reloads the page once so the browser fetches fresh
 * index.html with correct chunk URLs.
 *
 * Uses sessionStorage to prevent infinite reload loops — if we already
 * reloaded within the last 10 seconds, the error is re-thrown and caught
 * by the ErrorBoundary as usual.
 */

const RELOAD_KEY = "agentrune_chunk_reload_ts"
const RELOAD_COOLDOWN_MS = 10_000

type LazyFactory<T extends ComponentType<any>> = () => Promise<{ default: T }>

export function lazyRetry<T extends ComponentType<any>>(factory: LazyFactory<T>) {
  return lazy(() =>
    factory().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes("dynamically imported module") && !msg.includes("Failed to fetch")) {
        throw err // Not a chunk loading error — don't intercept
      }

      const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0)
      if (Date.now() - last < RELOAD_COOLDOWN_MS) {
        throw err // Already reloaded recently — avoid infinite loop
      }

      sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
      window.location.reload()
      // Return a never-resolving promise so React doesn't try to render stale state
      return new Promise<never>(() => {})
    }),
  )
}
