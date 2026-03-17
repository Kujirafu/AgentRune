import { defineConfig, loadEnv } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath } from "node:url"

const __dirname = fileURLToPath(new URL(".", import.meta.url))

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "VITE_")
  const defaultPort = mode === "development" ? "3457" : "3456"
  const port = env.VITE_DEFAULT_PORT || defaultPort

  return {
    plugins: [react(), tailwindcss()],
    define: {
      __APP_VERSION__: JSON.stringify("0.2.30"),
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      rollupOptions: {
        output: {
          manualChunks: {
            // Vendor: stable deps that rarely change → long-lived cache
            vendor: ["react", "react-dom"],
            // Split heavy deps into separate lazy-loadable chunks
            xterm: ["@xterm/xterm", "@xterm/addon-fit", "@xterm/addon-webgl"],
            markdown: ["react-markdown", "remark-gfm", "remark-parse", "unified"],
            motion: ["framer-motion"],
            qrcode: ["html5-qrcode"],
            capacitor: [
              "@capacitor/core", "@capacitor/app", "@capacitor/browser",
              "@capacitor/clipboard", "@capacitor/local-notifications",
              "@capacitor/push-notifications",
            ],
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
