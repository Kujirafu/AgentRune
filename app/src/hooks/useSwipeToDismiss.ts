import { useRef, useCallback, type RefObject } from "react"

interface SwipeToDismissOptions {
  onDismiss: () => void
  threshold?: number // px to trigger dismiss (default 120)
  sheetRef?: RefObject<HTMLDivElement | null> // optional external ref
}

/**
 * Adds swipe-down-to-dismiss gesture to a bottom sheet element.
 * Touch the top 60px area and drag down to dismiss.
 */
export function useSwipeToDismiss({ onDismiss, threshold = 120, sheetRef: externalRef }: SwipeToDismissOptions) {
  const internalRef = useRef<HTMLDivElement>(null)
  const ref = externalRef || internalRef
  const startY = useRef(0)
  const currentY = useRef(0)
  const dragging = useRef(false)

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const sheet = ref.current
    if (!sheet) return
    const rect = sheet.getBoundingClientRect()
    const touchY = e.touches[0].clientY
    if (touchY - rect.top > 60) return

    startY.current = touchY
    currentY.current = touchY
    dragging.current = true
    sheet.style.transition = "none"
  }, [ref])

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!dragging.current || !ref.current) return
    currentY.current = e.touches[0].clientY
    const dy = Math.max(0, currentY.current - startY.current)
    ref.current.style.transform = `translateY(${dy}px)`
    const backdrop = ref.current.previousElementSibling as HTMLElement | null
    if (backdrop) backdrop.style.opacity = String(Math.max(0, 1 - dy / 400))
  }, [ref])

  const onTouchEnd = useCallback(() => {
    if (!dragging.current || !ref.current) return
    dragging.current = false
    const dy = currentY.current - startY.current

    if (dy > threshold) {
      ref.current.style.transition = "transform 0.25s ease-out"
      ref.current.style.transform = "translateY(100%)"
      const backdrop = ref.current.previousElementSibling as HTMLElement | null
      if (backdrop) {
        backdrop.style.transition = "opacity 0.25s ease-out"
        backdrop.style.opacity = "0"
      }
      setTimeout(onDismiss, 250)
    } else {
      ref.current.style.transition = "transform 0.2s ease-out"
      ref.current.style.transform = "translateY(0)"
      const backdrop = ref.current.previousElementSibling as HTMLElement | null
      if (backdrop) {
        backdrop.style.transition = "opacity 0.2s ease-out"
        backdrop.style.opacity = "1"
      }
    }
  }, [ref, onDismiss, threshold])

  return {
    sheetRef: ref as RefObject<HTMLDivElement>,
    handlers: { onTouchStart, onTouchMove, onTouchEnd },
  }
}
