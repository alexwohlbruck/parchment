import { toast } from 'vue-sonner'
import { useAppStore } from '@/stores/app.store'
import {
  AutoFormDialogOptions,
  ComponentDialogOptions,
  ConfirmDialogOptions,
  DialogType,
  PromptDialogOptions,
} from '@/types/app.types'
import { createSharedComposable } from '@vueuse/core'

function appService() {
  const appStore = useAppStore()

  async function componentDialog(options: ComponentDialogOptions) {
    return appStore.createDialog(DialogType.Component, options)
  }

  async function confirm(options: ConfirmDialogOptions): Promise<boolean> {
    return appStore.createDialog(DialogType.Confirm, options)
  }

  async function prompt(options: PromptDialogOptions): Promise<string> {
    return appStore.createDialog(DialogType.Prompt, options)
  }

  async function promptForm(options: AutoFormDialogOptions): Promise<object> {
    return appStore.createDialog(DialogType.AutoForm, options)
  }

  return {
    componentDialog,
    confirm,
    prompt,
    promptForm,
    toast,
  }
}

export const useAppService = createSharedComposable(appService)
