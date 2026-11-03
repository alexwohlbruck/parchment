import { onMounted, onScopeDispose, shallowRef } from 'vue'
import { getSpeechCatalog } from '@/services/speech/speech.service'
import type { SpeechCatalog } from '@server/types/speech.types'

export function useSpeechCatalog() {
  const catalog = shallowRef<SpeechCatalog | null>(null)
  const controller = new AbortController()
  onMounted(async () => {
    try { catalog.value = await getSpeechCatalog(controller.signal) } catch {}
  })
  onScopeDispose(() => controller.abort())
  return { catalog }
}
