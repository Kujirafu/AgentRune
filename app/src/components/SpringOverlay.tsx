import type { ReactNode } from "react"
import { motion, AnimatePresence } from "framer-motion"

const springIn = { type: "spring" as const, stiffness: 200, damping: 20 }
const quickOut = { duration: 0.12, ease: "easeIn" as const }

interface SpringOverlayProps {
  open: boolean
  children: ReactNode
  zIndex?: number
}

export function SpringOverlay({ open, children, zIndex = 100 }: SpringOverlayProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12, transition: quickOut }}
          transition={springIn}
          style={{
            position: "fixed",
            inset: 0,
            zIndex,
          }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
