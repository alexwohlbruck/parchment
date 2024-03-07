import { useRouter } from 'vue-router'

const router = useRouter()

export function useAppNavigationService() {
  function navigateToPath(path: string) {
    router.push(path)
  }

  return {
    navigateToPath,
  }
}
