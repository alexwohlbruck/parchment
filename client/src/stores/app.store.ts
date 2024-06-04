import { DialogOptions, DialogType } from '@/types/app.types'
import { defineStore } from 'pinia'
import { Component, ref } from 'vue'

import ConfirmDialog from '@/components/dialogs/ConfirmDialog.vue'
import PromptDialog from '@/components/dialogs/PromptDialog.vue'
import AutoformDialog from '@/components/dialogs/AutoformDialog.vue'

export const useAppStore = defineStore('app', () => {
  const dialogs = ref<
    {
      id: number
      component: Component
      props: any
      onSubmit: Function
    }[]
  >([])

  function createDialog(
    type: DialogType,
    options: DialogOptions,
  ): Promise<any> {
    return new Promise(resolve => {
      const id = new Date().getTime()
      const dialogTypesMap = {
        [DialogType.Confirm]: ConfirmDialog,
        [DialogType.Prompt]: PromptDialog,
        [DialogType.AutoForm]: AutoformDialog,
        [DialogType.Template]: ConfirmDialog, // TODO
      }

      dialogs.value.push({
        id,
        component: dialogTypesMap[type],
        props: options,
        onSubmit: (payload: any) => {
          resolve(payload)
          setTimeout(() => removeDialog(id), 1000) // Wait for close animation
        },
      })
    })
  }

  function removeDialog(id: number) {
    const index = dialogs.value.findIndex(dialog => dialog.id === id)
    if (index !== -1) {
      dialogs.value.splice(index, 1)
    }
  }

  return {
    dialogs,
    createDialog,
    removeDialog,
  }
})
