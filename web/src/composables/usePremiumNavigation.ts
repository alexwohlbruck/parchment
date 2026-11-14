import { computed } from 'vue'
import { useAuthService } from '@/services/auth.service'
import { PermissionId } from '@/types/auth.types'

export function usePremiumNavigation() {
  return computed(() => useAuthService().hasPermission(PermissionId.PREMIUM_NAVIGATION))
}
