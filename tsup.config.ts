import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["server/index.ts"],
  format: ["esm"],
  target: "node18",
  outDir: "dist-server",
  banner: { js: "#!/usr/bin/env node" },
  clean: true,
})
