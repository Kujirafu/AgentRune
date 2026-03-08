#!/usr/bin/env npx tsx
/**
 * i18n 完整度檢查腳本
 * 比對 en.ts 和 zh-TW.ts 的翻譯 key，列出缺漏和多餘的項目
 *
 * 用法：cd app && npx tsx scripts/check-i18n.ts
 */

import { en } from "../src/lib/i18n/en.js"
import { zhTW } from "../src/lib/i18n/zh-TW.js"

const enKeys = new Set(Object.keys(en))
const zhKeys = new Set(Object.keys(zhTW))

const missingInZh = [...enKeys].filter(k => !zhKeys.has(k))
const extraInZh = [...zhKeys].filter(k => !enKeys.has(k))
const emptyInZh = [...zhKeys].filter(k => zhKeys.has(k) && enKeys.has(k) && !zhTW[k])
const emptyInEn = [...enKeys].filter(k => zhKeys.has(k) && enKeys.has(k) && !en[k])

console.log("═══════════════════════════════════════")
console.log("  i18n 完整度檢查")
console.log("═══════════════════════════════════════")
console.log()
console.log(`  EN keys:    ${enKeys.size}`)
console.log(`  ZH-TW keys: ${zhKeys.size}`)
console.log()

let hasIssue = false

if (missingInZh.length > 0) {
  hasIssue = true
  console.log(`❌ zh-TW 缺少 ${missingInZh.length} 個 key（EN 有但 ZH-TW 沒有）:`)
  for (const k of missingInZh) {
    console.log(`   - ${k}  →  EN: "${en[k]}"`)
  }
  console.log()
}

if (extraInZh.length > 0) {
  hasIssue = true
  console.log(`⚠️  zh-TW 多出 ${extraInZh.length} 個 key（ZH-TW 有但 EN 沒有）:`)
  for (const k of extraInZh) {
    console.log(`   - ${k}  →  ZH: "${zhTW[k]}"`)
  }
  console.log()
}

if (emptyInZh.length > 0) {
  hasIssue = true
  console.log(`🔲 zh-TW 有 ${emptyInZh.length} 個空值（key 存在但翻譯是空字串）:`)
  for (const k of emptyInZh) {
    console.log(`   - ${k}  →  EN: "${en[k]}"`)
  }
  console.log()
}

if (emptyInEn.length > 0) {
  hasIssue = true
  console.log(`🔲 EN 有 ${emptyInEn.length} 個空值（key 存在但翻譯是空字串）:`)
  for (const k of emptyInEn) {
    console.log(`   - ${k}  →  ZH: "${zhTW[k]}"`)
  }
  console.log()
}

if (!hasIssue) {
  console.log("✅ 完全一致，沒有缺漏！")
}

console.log("═══════════════════════════════════════")
process.exit(hasIssue ? 1 : 0)
