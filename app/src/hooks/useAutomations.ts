import { useState, useEffect, useCallback, useRef } from "react"
import type { AutomationConfig, AutomationResult } from "../data/automation-types"
import { buildApiUrl, canUseApi } from "../lib/storage"

/**
 * @param projectId - filter by project, or null to load ALL automations (cross-project)
 */
export function useAutomations(projectId: string | null, apiBase: string) {
  const [automations, setAutomations] = useState<AutomationConfig[]>([])
  const [results, setResults] = useState<Map<string, AutomationResult[]>>(new Map())
  const [loading, setLoading] = useState(false)
  const mountedRef = useRef(true)

  const refresh = useCallback(() => {
    const serverUrl = apiBase || localStorage.getItem("agentrune_server") || ""
    if (!canUseApi(serverUrl)) {
      setAutomations([])
      return
    }
    setLoading(true)
    // If projectId is null, fetch ALL automations (cross-project for desktop)
    const url = projectId
      ? buildApiUrl(`/api/automations/${projectId}`, serverUrl)
      : buildApiUrl(`/api/automations`, serverUrl)
    fetch(url)
      .then((r) => r.json())
      .then((data: AutomationConfig[]) => {
        if (!mountedRef.current) return
        setAutomations(Array.isArray(data) ? data : [])
        // Fetch recent results for each automation
        const resultMap = new Map<string, AutomationResult[]>()
        return Promise.all(
          (Array.isArray(data) ? data : []).map(async (a) => {
            try {
              const res = await fetch(
                buildApiUrl(`/api/automations/${a.projectId}/${a.id}/results?limit=5`, serverUrl)
              )
              if (res.ok) {
                const items: AutomationResult[] = await res.json()
                resultMap.set(a.id, Array.isArray(items) ? items : [])
              }
            } catch { /* ignore */ }
          })
        ).then(() => {
          if (mountedRef.current) setResults(new Map(resultMap))
        })
      })
      .catch(() => {
        if (mountedRef.current) setAutomations([])
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false)
      })
  }, [projectId, apiBase])

  useEffect(() => {
    mountedRef.current = true
    refresh()
    return () => { mountedRef.current = false }
  }, [refresh])

  const toggle = useCallback(async (id: string, enabled: boolean) => {
    const serverUrl = apiBase || localStorage.getItem("agentrune_server") || ""
    if (!canUseApi(serverUrl)) return
    // Find the automation to get its projectId for the API call
    const auto = automations.find(a => a.id === id)
    const pid = auto?.projectId || projectId
    if (!pid) return
    try {
      await fetch(buildApiUrl(`/api/automations/${pid}/${id}`, serverUrl), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      })
      setAutomations((prev) =>
        prev.map((a) => (a.id === id ? { ...a, enabled } : a))
      )
    } catch { /* ignore */ }
  }, [projectId, apiBase, automations])

  return { automations, results, loading, toggle, refresh }
}
