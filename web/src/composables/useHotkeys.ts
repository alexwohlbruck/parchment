import { onMounted, onUnmounted } from 'vue'
import mousetrap from 'mousetrap'

interface HotkeyBinding {
  key: string
  handler: () => void
}

export function useHotkeys(bindings: HotkeyBinding | HotkeyBinding[]) {
  onMounted(() => {
    const bindingArray = Array.isArray(bindings) ? bindings : [bindings]

    bindingArray.forEach(({ key, handler }) => {
      mousetrap.bind(key, e => {
        e.preventDefault()
        handler()
      })
    })
  })

  onUnmounted(() => {
    const bindingArray = Array.isArray(bindings) ? bindings : [bindings]

    bindingArray.forEach(({ key }) => {
      mousetrap.unbind(key)
    })
  })
}
