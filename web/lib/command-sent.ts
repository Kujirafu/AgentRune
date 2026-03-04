// Tracks which sessions have already had their auto-command sent.
// Module-level Set survives component mount/unmount cycles.
const sentSessions = new Set<string>()

export const commandSent = {
  has: (id: string) => sentSessions.has(id),
  mark: (id: string) => { sentSessions.add(id) },
  reset: (id: string) => { sentSessions.delete(id) },
}
