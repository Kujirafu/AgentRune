export interface TerminalRendererWindowLike {
  electronAPI?: unknown
}

export function shouldUseXtermWebgl(target?: TerminalRendererWindowLike): boolean {
  const resolvedTarget = arguments.length === 0
    ? (typeof window !== "undefined" ? window as TerminalRendererWindowLike : undefined)
    : target

  if (!resolvedTarget) return false
  return !("electronAPI" in resolvedTarget) || resolvedTarget.electronAPI == null
}
