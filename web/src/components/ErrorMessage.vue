<script setup lang="ts">
import { computed } from 'vue'
import { Button } from '@/components/ui/button'
import {
  AlertTriangleIcon,
  AlertCircleIcon,
  InfoIcon,
  CheckCircleIcon,
} from 'lucide-vue-next'

export type StatusType = 'error' | 'warning' | 'info' | 'success'

const props = withDefaults(
  defineProps<{
    type?: StatusType
    title?: string
    message?: string
    buttonText?: string
    showButton?: boolean
    icon?: any
  }>(),
  {
    type: 'error',
    title: '',
    message: '',
    buttonText: 'Try Again',
    showButton: true,
  },
)

const emit = defineEmits<{
  action: []
}>()

const statusConfig = computed(() => {
  const configs = {
    error: {
      icon: AlertTriangleIcon,
      bgColor: 'bg-red-50 dark:bg-red-900',
      iconColor: 'text-red-500 dark:text-red-300',
      title: 'Error',
    },
    warning: {
      icon: AlertCircleIcon,
      bgColor: 'bg-yellow-50 dark:bg-yellow-900',
      iconColor: 'text-yellow-500 dark:text-yellow-300',
      title: 'Warning',
    },
    info: {
      icon: InfoIcon,
      bgColor: 'bg-blue-50 dark:bg-blue-900',
      iconColor: 'text-blue-500 dark:text-blue-300',
      title: 'Information',
    },
    success: {
      icon: CheckCircleIcon,
      bgColor: 'bg-green-50 dark:bg-green-900',
      iconColor: 'text-green-500 dark:text-green-300',
      title: 'Success',
    },
  }
  return configs[props.type]
})

const IconComponent = computed(() => props.icon || statusConfig.value.icon)

function handleAction() {
  emit('action')
}
</script>

<template>
  <div class="flex flex-col items-center justify-center py-12 space-y-3">
    <div
      class="w-12 h-12 rounded-full flex items-center justify-center"
      :class="statusConfig.bgColor"
    >
      <IconComponent class="w-6 h-6" :class="statusConfig.iconColor" />
    </div>
    <div class="text-center space-y-1 max-w-md mx-auto">
      <h3 class="text-base font-semibold text-foreground">
        {{ title || statusConfig.title }}
      </h3>
      <p v-if="message" class="text-sm text-muted-foreground leading-relaxed">
        {{ message }}
      </p>
      <div v-if="showButton" class="pt-1.5">
        <Button @click="handleAction" variant="outline" size="sm">
          {{ buttonText }}
        </Button>
      </div>
    </div>
  </div>
</template>
