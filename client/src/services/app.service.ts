import { useAppStore } from '@/stores/app.store'
import {
  ConfirmDialogOptions,
  DialogType,
  PromptDialogOptions,
} from '@/types/app.types'
import { createSharedComposable } from '@vueuse/core'

function appService() {
  const appStore = useAppStore()

  async function confirm(options: ConfirmDialogOptions): Promise<boolean> {
    return appStore.createDialog(DialogType.Confirm, options)
  }

  async function prompt(options: PromptDialogOptions): Promise<string> {
    return appStore.createDialog(DialogType.Prompt, options)
  }

  return {
    confirm,
  }
}

export const useAppService = createSharedComposable(appService)
