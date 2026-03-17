import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from "react"

export type Locale = "en" | "zh-TW" // Future: "zh-CN" | "ja" | "es" | "pt"

// Dynamic loaders — each locale becomes its own chunk, loaded on demand
const loaders: Record<Locale, () => Promise<Record<string, string>>> = {
  "en": () => import("./en").then(m => m.en),
  "zh-TW": () => import("./zh-TW").then(m => m.zhTW),
}

// Persist loaded translations across re-renders / locale switches.
// Dedup in-flight loads so StrictMode double-mount doesn't fire two fetches.
const cache: Partial<Record<Locale, Record<string, string>>> = {}
const loading: Partial<Record<Locale, Promise<Record<string, string>>>> = {}

function loadLocale(loc: Locale): Promise<Record<string, string>> {
  if (cache[loc]) return Promise.resolve(cache[loc])
  if (!loading[loc]) {
    loading[loc] = loaders[loc]().then(d => { cache[loc] = d; return d })
  }
  return loading[loc]
}

interface LocaleContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: string, params?: Record<string, string>) => string
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: "zh-TW",
  setLocale: () => {},
  t: (key) => key,
})

function detectLocale(): Locale {
  const saved = localStorage.getItem("agentrune_locale")
  if (saved === "en" || saved === "zh-TW") return saved
  const lang = navigator.language
  if (lang.startsWith("zh")) return "zh-TW"
  return "en"
}

const initialLocale = detectLocale()

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale)
  const [dict, setDict] = useState<Record<string, string> | null>(
    cache[initialLocale] ?? null,
  )
  const fallbackRef = useRef<Record<string, string>>(cache["en"] ?? {})

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // Load active locale
      const activeDict = await loadLocale(locale)
      // Await English fallback so fallbackRef is populated before render
      const enDict = locale !== "en" ? await loadLocale("en") : {}
      if (!cancelled) {
        setDict(activeDict)
        fallbackRef.current = enDict
      }
    })()
    return () => { cancelled = true }
  }, [locale])

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l)
    localStorage.setItem("agentrune_locale", l)
  }, [])

  const t = useCallback((key: string, params?: Record<string, string>): string => {
    let str = (dict ?? {})[key] ?? fallbackRef.current[key] ?? key
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        str = str.replaceAll(`{${k}}`, v)
      }
    }
    return str
  }, [dict])

  // Gate: don't render children until the active locale is loaded.
  // Dynamic import of a local chunk resolves in < 10 ms — no visible flash.
  // During locale switch, dict retains the old locale for one frame (better than blank).
  if (!dict) return null

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </LocaleContext.Provider>
  )
}

export function useLocale() {
  return useContext(LocaleContext)
}

export const SUPPORTED_LOCALES: { id: Locale; label: string }[] = [
  { id: "en", label: "English" },
  { id: "zh-TW", label: "繁體中文" },
]

// HMR: clear cache when locale files are edited during development
if (import.meta.hot) {
  import.meta.hot.accept(["./en", "./zh-TW"], () => {
    for (const k of Object.keys(cache)) delete cache[k as Locale]
    for (const k of Object.keys(loading)) delete loading[k as Locale]
  })
}
