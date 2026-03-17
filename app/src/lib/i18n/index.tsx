import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"

export type Locale = "en" | "zh-TW"

const loaders: Record<Locale, () => Promise<Record<string, string>>> = {
  en: () => import("./en").then((mod) => mod.en),
  "zh-TW": () => import("./zh-TW").then((mod) => mod.zhTW),
}

const cache: Partial<Record<Locale, Record<string, string>>> = {}
const loading: Partial<Record<Locale, Promise<Record<string, string>>>> = {}

function loadLocale(locale: Locale): Promise<Record<string, string>> {
  if (cache[locale]) return Promise.resolve(cache[locale])
  if (!loading[locale]) {
    loading[locale] = loaders[locale]().then((dictionary) => {
      cache[locale] = dictionary
      return dictionary
    })
  }
  return loading[locale]!
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
  return navigator.language.startsWith("zh") ? "zh-TW" : "en"
}

const initialLocale = detectLocale()

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale)
  const [dict, setDict] = useState<Record<string, string> | null>(cache[initialLocale] ?? null)
  const fallbackRef = useRef<Record<string, string>>(cache.en ?? {})

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      const activeDict = await loadLocale(locale)
      const enDict = locale !== "en" ? await loadLocale("en") : {}
      if (cancelled) return
      setDict(activeDict)
      fallbackRef.current = enDict
    })()

    return () => {
      cancelled = true
    }
  }, [locale])

  const setLocale = useCallback((nextLocale: Locale) => {
    setLocaleState(nextLocale)
    localStorage.setItem("agentrune_locale", nextLocale)
  }, [])

  const t = useCallback((key: string, params?: Record<string, string>) => {
    let text = (dict ?? {})[key] ?? fallbackRef.current[key] ?? key
    if (params) {
      for (const [name, value] of Object.entries(params)) {
        text = text.replaceAll(`{${name}}`, value)
      }
    }
    return text
  }, [dict])

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

if (import.meta.hot) {
  import.meta.hot.accept(["./en", "./zh-TW"], () => {
    for (const key of Object.keys(cache)) delete cache[key as Locale]
    for (const key of Object.keys(loading)) delete loading[key as Locale]
  })
}
