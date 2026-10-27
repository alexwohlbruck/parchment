import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { IntegrationCapabilityId } from '../types/integration.enums'
const getCatalog = mock(async () => ({ model: 'test', voices: [], rate: { min: 0.75, max: 1.5, default: 1, native: true }, inflection: false }))
const synthesize = mock(async () => new Uint8Array([1]))
let enabled = true
const getConfiguredIntegrationsByCapability = mock((capability: IntegrationCapabilityId) => enabled && capability === IntegrationCapabilityId.TTS ? [{ id: 'test' }] : [])
mock.module('./integrations', () => ({ integrationManager: { getConfiguredIntegrationsByCapability, getCachedIntegrationInstance: () => ({ capabilities: { tts: { getCatalog, synthesize } } }) } }))
const { getSpeechCatalog, synthesizeSpeech } = await import('./speech.service')
beforeEach(() => { enabled = true })
describe('configured speech providers', () => {
  test('uses the enabled TTS capability', async () => {
    const request = { text: 'Turn left', language: 'en', rate: 1.25 }
    await getSpeechCatalog()
    expect(await synthesizeSpeech(request)).toEqual(new Uint8Array([1]))
    expect(getConfiguredIntegrationsByCapability).toHaveBeenCalledWith(IntegrationCapabilityId.TTS)
    expect(synthesize).toHaveBeenCalledWith(request, undefined)
  })
  test('reports unavailable when the capability is disabled', async () => {
    enabled = false
    await expect(getSpeechCatalog()).rejects.toThrow('unavailable')
    await expect(synthesizeSpeech({ text: 'Turn', language: 'en' })).rejects.toThrow('unavailable')
  })
})
