export interface SpeechVoice {
  id: string
  name: string
  language: string
}

export interface SpeechCatalog {
  model: string
  voices: SpeechVoice[]
  rate: { min: number; max: number; default: number; native: boolean }
  inflection: boolean
}

export interface SpeechRequest {
  text: string
  language: string
  voice?: string
  rate?: number
}

export interface SpeechCapability {
  getCatalog(signal?: AbortSignal): Promise<SpeechCatalog>
  /** Returns encoded MP3 audio. */
  synthesize(request: SpeechRequest, signal?: AbortSignal): Promise<Uint8Array>
}
