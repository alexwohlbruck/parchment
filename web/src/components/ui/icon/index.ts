import { defineComponent, h } from 'vue'
import * as LucideIcons from 'lucide-vue-next'

export const Icon = defineComponent({
  name: 'Icon',
  props: {
    name: {
      type: String,
      required: true,
    },
  },
  setup(props) {
    return () => h(LucideIcons[props.name as keyof typeof LucideIcons])
  },
})
