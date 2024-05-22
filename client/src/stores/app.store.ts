import { DialogOptions, DialogType } from '@/types/app.types'
import { defineStore } from 'pinia'
import { Component, ref } from 'vue'

import ConfirmDialog from '@/components/dialogs/ConfirmDialog.vue'
import { on } from 'events'

export const useAppStore = defineStore('app', () => {
  const dialogs = ref<
    {
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
      const onSubmit = (payload: any) => {
        resolve(payload)
        setTimeout(() => removeDialog(dialogs.value.length - 1), 1000) // Wait for close animation
      }

      switch (type) {
        case DialogType.Confirm:
          dialogs.value.push({
            component: ConfirmDialog,
            props: options,
            onSubmit,
          })
          break
        case DialogType.Prompt:
          // TODO
          break
        case DialogType.AutoForm:
          // TODO
          break
        case DialogType.Template:
          // TODO
          break
      }
    })
  }

  function removeDialog(index: number) {
    dialogs.value.splice(index, 1)
  }

  return {
    dialogs,
    createDialog,
    removeDialog,
  }
})
