import { defineConfig, loadEnv } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath } from "node:url"

const __dirname = fileURLToPath(new URL(".", import.meta.url))

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "VITE_")
  const port = env.VITE_DEFAULT_PORT || "3456"

  return {
    plugins: [react(), tailwindcss()],
    define: {
      __APP_VERSION__: JSON.stringify("0.2.15"),
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      rollupOptions: {
        output: {
          manualChunks: {
            // Split heavy deps into separate lazy-loadable chunks
            xterm: ["@xterm/xterm", "@xterm/addon-fit", "@xterm/addon-webgl"],
            markdown: ["react-markdown", "remark-gfm", "remark-parse", "unified"],
            // framer-motion stays in main bundle — needed for page transitions on first paint
          },
        },
      },
    },
    server: {
      host: true,
      proxy: {
        "/api": `http://localhost:${port}`,
        "/ws": { target: `ws://localhost:${port}`, ws: true },
      },
    },
  }
})
