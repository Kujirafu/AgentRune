import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["server/index.ts"],
  format: ["cjs"],
  target: "node18",
  outDir: "dist-server",
  banner: { js: "#!/usr/bin/env node" },
  shims: true,   // converts import.meta.url → __filename in CJS
  clean: true,
})
