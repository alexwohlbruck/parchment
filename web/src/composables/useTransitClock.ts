import { ref, onMounted, onUnmounted, type Ref } from 'vue'

const ONE_MINUTE_MS = 60_000

/**
 * Reactive `currentTime` ref that updates once per minute. Drives "next
 * departure in N min" countdowns without re-rendering on every frame.
 * Each consumer owns its own timer (cheap — one ID per place sheet) so
 * unmounting cleanly stops the tick.
 */
export function useTransitClock(): Ref<Date> {
  const currentTime = ref(new Date())
  let id: ReturnType<typeof setInterval> | null = null

  onMounted(() => {
    id = setInterval(() => {
      currentTime.value = new Date()
    }, ONE_MINUTE_MS)
  })

  onUnmounted(() => {
    if (id !== null) clearInterval(id)
  })

  return currentTime
}
