import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/bin.ts"],
  format: ["esm"],
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  shims: true,
  external: ["node-pty"],
})
