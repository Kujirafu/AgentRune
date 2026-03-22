import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/bin.ts", "src/server-entry.ts"],
  format: ["esm"],
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  shims: true,
  external: ["node-pty"],
})
