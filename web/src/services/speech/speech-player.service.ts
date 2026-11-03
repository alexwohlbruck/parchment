export interface SpeechOptions {
  lang: string
  voice?: string
  rate?: number
  urgent?: boolean
  maxAgeMs?: number
}

interface SpeechOutput {
  synthesize(text: string, options: SpeechOptions, signal: AbortSignal): Promise<Blob>
  playAudio(audio: Blob, signal: AbortSignal): Promise<void>
  playBrowser(text: string, options: SpeechOptions, signal: AbortSignal): Promise<void>
  onFallback?(error: unknown, options: SpeechOptions): void
}

interface Prompt { text: string; options: SpeechOptions; expires: number }

export class SpeechPlayer {
  private queue: Prompt[] = []
  private active: AbortController | null = null
  private running = false

  constructor(private readonly output: SpeechOutput) {}

  speak(text: string, options: SpeechOptions): void {
    if (!text.trim()) return
    if (options.urgent) this.stop()
    if (this.queue.length >= 3) this.queue.shift()
    this.queue.push({ text, options, expires: Date.now() + (options.maxAgeMs ?? 8000) })
    void this.drain()
  }

  stop(): void {
    this.queue = []
    this.active?.abort()
  }

  private async drain(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      while (this.queue.length) {
        const prompt = this.queue.shift()!
        if (prompt.expires <= Date.now()) continue
        const synthesisBudget = prompt.options.urgent ? 1500 : 3000
        const controller = new AbortController()
        this.active = controller
        const signal = controller.signal
        const request = new AbortController()
        let rejectCancelled: ((reason: Error) => void) | undefined
        const cancelled = new Promise<never>((_, reject) => { rejectCancelled = reject })
        const cancelRequest = () => { request.abort(); rejectCancelled?.(new Error('Speech cancelled')) }
        signal.addEventListener('abort', cancelRequest, { once: true })
        const expiry = setTimeout(() => controller.abort(), Math.max(0, prompt.expires - Date.now()))
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => { request.abort(); reject(new Error('Speech deadline exceeded')) }, Math.min(synthesisBudget, prompt.expires - Date.now()))
          })
          try {
            const audio = await Promise.race([this.output.synthesize(prompt.text, prompt.options, request.signal), timeout, cancelled])
            clearTimeout(timer)
            if (!signal.aborted && prompt.expires > Date.now()) await Promise.race([this.output.playAudio(audio, signal), cancelled])
          } catch (error) {
            clearTimeout(timer)
            if (!signal.aborted && prompt.expires > Date.now()) {
              this.output.onFallback?.(error, prompt.options)
              await Promise.race([this.output.playBrowser(prompt.text, prompt.options, signal), cancelled])
            }
          }
        } catch {
        } finally {
          clearTimeout(expiry)
          clearTimeout(timer)
          signal.removeEventListener('abort', cancelRequest)
          if (this.active === controller) this.active = null
        }
      }
    } finally { this.running = false }
  }
}
