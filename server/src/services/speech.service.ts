import { integrationManager } from './integrations'
import { IntegrationCapabilityId } from '../types/integration.enums'
import type { SpeechCatalog, SpeechRequest } from '../types/speech.types'

function providers() {
  return integrationManager.getConfiguredIntegrationsByCapability(IntegrationCapabilityId.TTS)
    .map(record => integrationManager.getCachedIntegrationInstance(record)?.capabilities.tts)
    .filter(provider => provider !== undefined)
}

export async function getSpeechCatalog(signal?: AbortSignal): Promise<SpeechCatalog> {
  for (const provider of providers()) {
    try { return await provider.getCatalog(signal) } catch {
      if (signal?.aborted) throw signal.reason
    }
  }
  throw new Error('Speech synthesis unavailable')
}

export async function synthesizeSpeech(request: SpeechRequest, signal?: AbortSignal): Promise<Uint8Array> {
  for (const provider of providers()) {
    try { return await provider.synthesize(request, signal) } catch {
      if (signal?.aborted) throw signal.reason
    }
  }
  throw new Error('Speech synthesis unavailable')
}
