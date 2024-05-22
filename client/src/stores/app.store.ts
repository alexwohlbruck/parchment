import { DialogOptions, DialogType } from '@/types/app.types'
import { defineStore } from 'pinia'
import { Component, ref } from 'vue'

import ConfirmDialog from '@/components/dialogs/ConfirmDialog.vue'

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

      const onSubmit = (payload: any) => {
        resolve(payload)
        setTimeout(() => removeDialog(id), 1000) // Wait for close animation
      }

      switch (type) {
        case DialogType.Confirm:
          dialogs.value.push({
            id,
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
