import { describe, expect, it } from "vitest"
import {
  getForwardedClientIp,
  getRequestClientIp,
  isExemptApiAuthPath,
  isLoopbackAddress,
  isTrustedLocalRequest,
} from "./request-security.js"

describe("request-security", () => {
  it("recognizes loopback variants", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true)
    expect(isLoopbackAddress("::1")).toBe(true)
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true)
    expect(isLoopbackAddress("203.0.113.10")).toBe(false)
  })

  it("prefers forwarded client IP headers over the socket IP", () => {
    const req = {
      headers: {
        "cf-connecting-ip": "198.51.100.7",
        "x-forwarded-for": "203.0.113.8, 127.0.0.1",
      },
      socket: { remoteAddress: "127.0.0.1" },
    }

    expect(getForwardedClientIp(req)).toBe("198.51.100.7")
    expect(getRequestClientIp(req)).toBe("198.51.100.7")
  })

  it("only trusts direct localhost requests without proxy headers", () => {
    expect(isTrustedLocalRequest({
      headers: {},
      socket: { remoteAddress: "127.0.0.1" },
    })).toBe(true)

    expect(isTrustedLocalRequest({
      headers: { "x-forwarded-for": "198.51.100.99" },
      socket: { remoteAddress: "127.0.0.1" },
    })).toBe(false)

    expect(isTrustedLocalRequest({
      headers: {},
      socket: { remoteAddress: "198.51.100.99" },
    })).toBe(false)
  })

  it("exempts auth routes except new-code regardless of mounted path", () => {
    expect(isExemptApiAuthPath("/auth/pair")).toBe(true)
    expect(isExemptApiAuthPath("/api/auth/cloud")).toBe(true)
    expect(isExemptApiAuthPath("/auth/new-code")).toBe(false)
    expect(isExemptApiAuthPath("/api/projects")).toBe(false)
  })
})
