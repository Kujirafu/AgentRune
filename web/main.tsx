import { createRoot } from "react-dom/client"
import { App } from "./App.js"
import { LocaleProvider } from "./lib/i18n/index.js"

createRoot(document.getElementById("root")!).render(
  <LocaleProvider>
    <App />
  </LocaleProvider>
)
