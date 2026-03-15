import { describe, it, expect } from "vitest"
import { BUILTIN_TEMPLATES, TEMPLATE_GROUPS, SUBGROUP_LABELS } from "./builtin-templates"

describe("BUILTIN_TEMPLATES", () => {
  it("has at least 20 templates", () => {
    expect(BUILTIN_TEMPLATES.length).toBeGreaterThanOrEqual(20)
  })

  it("all templates have required fields", () => {
    for (const tpl of BUILTIN_TEMPLATES) {
      expect(tpl.id).toBeTruthy()
      expect(tpl.name).toBeTruthy()
      expect(tpl.description).toBeTruthy()
      expect(tpl.icon).toBeTruthy()
      expect(tpl.prompt).toBeTruthy()
      expect(tpl.category).toBe("builtin")
      expect(tpl.visibility).toBe("public")
    }
  })

  it("all template ids are unique", () => {
    const ids = BUILTIN_TEMPLATES.map(t => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("all template ids start with builtin_", () => {
    for (const tpl of BUILTIN_TEMPLATES) {
      expect(tpl.id.startsWith("builtin_")).toBe(true)
    }
  })

  it("templates have zero initial ratings", () => {
    for (const tpl of BUILTIN_TEMPLATES) {
      expect(tpl.rating).toBe(0)
      expect(tpl.ratingCount).toBe(0)
      expect(tpl.pinCount).toBe(0)
    }
  })
})

describe("TEMPLATE_GROUPS", () => {
  it("has code, ops, docs groups", () => {
    const keys = TEMPLATE_GROUPS.map(g => g.key)
    expect(keys).toContain("code")
    expect(keys).toContain("ops")
    expect(keys).toContain("docs")
  })

  it("all groups have label i18n keys", () => {
    for (const group of TEMPLATE_GROUPS) {
      expect(group.label).toMatch(/^tpl\.group\./)
    }
  })
})

describe("SUBGROUP_LABELS", () => {
  it("has expected subgroups", () => {
    expect(SUBGROUP_LABELS).toHaveProperty("git")
    expect(SUBGROUP_LABELS).toHaveProperty("security")
    expect(SUBGROUP_LABELS).toHaveProperty("quality")
  })

  it("all values are i18n keys", () => {
    for (const val of Object.values(SUBGROUP_LABELS)) {
      expect(val).toMatch(/^tpl\.group\./)
    }
  })
})
