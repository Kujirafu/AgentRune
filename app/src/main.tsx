import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import { LocaleProvider } from "./lib/i18n/index.js"
import { initAnalytics, trackAppOpen } from "./lib/analytics"
import "./app.css"

initAnalytics()
trackAppOpen()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LocaleProvider>
      <App />
    </LocaleProvider>
  </StrictMode>
)
