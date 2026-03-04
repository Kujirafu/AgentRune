// server/qr-terminal.ts
// Display a real QR code in the terminal for phone scanning

import qrcode from "qrcode-terminal"

export function printConnectionInfo(url: string, code: string): void {
  const pairUrl = `${url}/pair?pair=${code}`

  console.log()
  console.log("  ┌──────────────────────────────────────────┐")
  console.log("  │           AgentRune Pairing               │")
  console.log("  │                                          │")
  console.log(`  │  Code: ${code}                              │`)
  console.log("  │                                          │")
  console.log("  │  Scan the QR code below with your phone: │")
  console.log("  └──────────────────────────────────────────┘")
  console.log()

  // Render actual QR code in terminal
  qrcode.generate(pairUrl, { small: true }, (qr: string) => {
    // Indent each line for alignment
    const lines = qr.split("\n")
    for (const line of lines) {
      console.log(`    ${line}`)
    }
    console.log()
    console.log(`    ${pairUrl}`)
    console.log()
  })
}
