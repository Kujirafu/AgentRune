import { describe, it, expect } from "vitest"
import { BUILTIN_CREWS, CHAIN_TEMPLATES } from "./builtin-crews"

describe("BUILTIN_CREWS", () => {
  it("has 6 multi-role crew templates", () => {
    expect(BUILTIN_CREWS).toHaveLength(6)
  })

  it("all templates have required fields", () => {
    for (const tpl of BUILTIN_CREWS) {
      expect(tpl.id).toBeTruthy()
      expect(tpl.name).toBeTruthy()
      // description is empty — resolved via i18n at runtime
      expect(tpl.category).toBe("crew")
      expect(tpl.crew).toBeDefined()
      expect(tpl.crew!.roles.length).toBeGreaterThanOrEqual(2)
      expect(tpl.crew!.tokenBudget).toBeGreaterThan(0)
    }
  })

  it("all template ids are unique", () => {
    const ids = BUILTIN_CREWS.map(t => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("crew roles have required fields", () => {
    for (const tpl of BUILTIN_CREWS) {
      for (const role of tpl.crew!.roles) {
        expect(role.id).toBeTruthy()
        expect(role.nameKey).toBeTruthy()
        expect(role.prompt).toBeTruthy()
        expect(role.icon).toBeTruthy()
        expect(role.color).toMatch(/^#/)
        expect(role.phase).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it("crew roles have unique ids within each crew", () => {
    for (const tpl of BUILTIN_CREWS) {
      const ids = tpl.crew!.roles.map(r => r.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })
})

describe("CHAIN_TEMPLATES", () => {
  it("has 29 single-role chain templates", () => {
    expect(CHAIN_TEMPLATES).toHaveLength(29)
  })

  it("all templates have required fields", () => {
    for (const tpl of CHAIN_TEMPLATES) {
      expect(tpl.id).toBeTruthy()
      expect(tpl.name).toBeTruthy()
      // description is empty — resolved via i18n at runtime
      expect(tpl.category).toBe("crew")
      expect(tpl.crew).toBeDefined()
      expect(tpl.crew!.roles).toHaveLength(1)
    }
  })

  it("all template ids are unique", () => {
    const ids = CHAIN_TEMPLATES.map(t => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("no id conflicts between crews and chains", () => {
    const crewIds = new Set(BUILTIN_CREWS.map(t => t.id))
    for (const chain of CHAIN_TEMPLATES) {
      expect(crewIds.has(chain.id)).toBe(false)
    }
  })

  it("each chain template role has skillChainSlug", () => {
    for (const tpl of CHAIN_TEMPLATES) {
      const role = tpl.crew!.roles[0]
      expect(role.skillChainSlug).toBeTruthy()
    }
  })

  it("feature chain template exists", () => {
    const feature = CHAIN_TEMPLATES.find(t => t.id === "chain_feature")
    expect(feature).toBeDefined()
  })

  it("bugfix chain template exists", () => {
    const bugfix = CHAIN_TEMPLATES.find(t => t.id === "chain_bugfix")
    expect(bugfix).toBeDefined()
  })
})
