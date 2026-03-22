import { useState, useEffect } from "react"

function isCapacitor(): boolean {
  return typeof window !== "undefined" &&
    !!(window as any).Capacitor &&
    (window as any).Capacitor.isNativePlatform?.() === true
}

export function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(
    () => typeof window !== "undefined" && window.innerWidth >= 900 && !isCapacitor()
  )

  useEffect(() => {
    if (isCapacitor()) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const handler = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setDesktop(window.innerWidth >= 900), 200)
    }
    window.addEventListener("resize", handler)
    return () => {
      window.removeEventListener("resize", handler)
      if (timer) clearTimeout(timer)
    }
  }, [])

  return desktop
}
