interface RequestLike {
  headers?: Record<string, string | string[] | undefined>
  path?: string
  url?: string
  socket?: {
    remoteAddress?: string | null
  }
}

function firstHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0]?.trim() || ""
  return value?.trim() || ""
}

export function isLoopbackAddress(ip?: string | null): boolean {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1"
}

export function getForwardedClientIp(req: RequestLike): string {
  const cfIp = firstHeaderValue(req.headers?.["cf-connecting-ip"])
  if (cfIp) return cfIp

  const xff = firstHeaderValue(req.headers?.["x-forwarded-for"])
  if (!xff) return ""
  return xff.split(",")[0]?.trim() || ""
}

export function getRequestClientIp(req: RequestLike): string {
  return getForwardedClientIp(req) || req.socket?.remoteAddress || ""
}

export function isTrustedLocalRequest(req: RequestLike): boolean {
  return isLoopbackAddress(req.socket?.remoteAddress) && !getForwardedClientIp(req)
}

export function isExemptApiAuthPath(path?: string): boolean {
  if (!path) return false
  const normalizedPath = path.startsWith("/api/") ? path.slice(4) : path
  return normalizedPath.startsWith("/auth/") && normalizedPath !== "/auth/new-code"
}
