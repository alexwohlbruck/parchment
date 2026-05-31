import { ref } from 'vue'
import { useAppService } from '@/services/app.service'

export function useClipboard() {
  const { toast } = useAppService()
  const copied = ref(false)
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  async function copy(text: string, message?: string) {
    if (timeoutId) clearTimeout(timeoutId)

    await navigator.clipboard.writeText(text)
    toast.info(message ?? 'Copied to clipboard')
    copied.value = true

    timeoutId = setTimeout(() => {
      copied.value = false
    }, 1500)
  }

  return { copied, copy }
}
