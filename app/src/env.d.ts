/// <reference types="vite/client" />

// Vite define globals
declare const __APP_VERSION__: string
declare const __BUILD_TIME__: string

// html5-qrcode — no @types package available
declare module "html5-qrcode" {
  export class Html5Qrcode {
    constructor(elementId: string)
    start(
      cameraIdOrConfig: string | { facingMode: string },
      config: { fps: number; qrbox: { width: number; height: number } },
      onSuccess: (decodedText: string) => void,
      onError: (error: string) => void,
    ): Promise<void>
    stop(): Promise<void>
  }
}
