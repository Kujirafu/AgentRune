import { render, type RenderOptions } from "@testing-library/react"
import { LocaleProvider } from "../lib/i18n/index.js"
import type { ReactElement } from "react"

function Wrapper({ children }: { children: React.ReactNode }) {
  return <LocaleProvider>{children}</LocaleProvider>
}

export function renderWithProviders(ui: ReactElement, options?: RenderOptions) {
  return render(ui, { wrapper: Wrapper, ...options })
}

export { screen, waitFor, within } from "@testing-library/react"
export { default as userEvent } from "@testing-library/user-event"
