import { createContext, useContext, useState, useCallback, type ReactNode } from "react"
import { en } from "./en"
import { zhTW } from "./zh-TW"

export type Locale = "en" | "zh-TW" // Future: "zh-CN" | "ja" | "es" | "pt"

const translations: Record<Locale, Record<string, string>> = {
  "en": en,
  "zh-TW": zhTW,
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

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale)

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l)
    localStorage.setItem("agentrune_locale", l)
  }, [])

  const t = useCallback((key: string, params?: Record<string, string>): string => {
    let str = translations[locale]?.[key] || translations["en"]?.[key] || key
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        str = str.replace(`{${k}}`, v)
      }
    }
    return str
  }, [locale])

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
