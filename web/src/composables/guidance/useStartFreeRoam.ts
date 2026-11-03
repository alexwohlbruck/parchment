import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import { useGuidanceStore } from '@/stores/guidance.store'
import type { FreeMode } from '@/lib/guidance/free-roam'

/** Opens navigation with no destination, following whatever road is ahead. */
export function useStartFreeRoam() {
  const router = useRouter()
  const guidance = useGuidanceStore()

  return async function startFreeRoam(mode: FreeMode) {
    await guidance.roam(mode)
    await router.push({ name: AppRoute.GUIDANCE })
  }
}
