<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Shield, AlertTriangle, Lock } from 'lucide-vue-next'

interface Props {
  isSensitive: boolean
  disabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
})

const emit = defineEmits<{
  'update:isSensitive': [value: boolean]
}>()

const internalValue = ref(props.isSensitive)

watch(
  () => props.isSensitive,
  (v) => {
    internalValue.value = v
  },
)

function handleToggle(value: boolean) {
  internalValue.value = value
  emit('update:isSensitive', value)
}
</script>

<template>
  <div class="space-y-4">
    <!-- Toggle -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div
          class="p-2 rounded-lg"
          :class="
            internalValue
              ? 'bg-green-100 dark:bg-green-900/30'
              : 'bg-muted'
          "
        >
          <Shield
            class="h-5 w-5"
            :class="
              internalValue
                ? 'text-green-600 dark:text-green-400'
                : 'text-muted-foreground'
            "
          />
        </div>
        <div>
          <Label class="text-base font-medium">Sensitive Collection</Label>
          <p class="text-sm text-muted-foreground">
            End-to-end encrypt all points in this collection
          </p>
        </div>
      </div>
      <Switch
        :checked="internalValue"
        @update:checked="handleToggle"
        :disabled="disabled"
      />
    </div>

    <!-- Warning when enabled -->
    <Alert v-if="internalValue" variant="default" class="border-green-500/50">
      <Lock class="h-4 w-4" />
      <AlertTitle>E2E Encryption Enabled</AlertTitle>
      <AlertDescription class="text-sm space-y-2">
        <p>
          Points in this collection will be encrypted on your device before
          being stored on the server.
        </p>
        <ul class="list-disc list-inside text-muted-foreground space-y-1">
          <li>The server cannot read or search your data</li>
          <li>Only you can decrypt points (using your recovery key)</li>
          <li>Search within this collection is client-side only</li>
          <li>
            Points can be shared with friends using E2E encryption
          </li>
        </ul>
      </AlertDescription>
    </Alert>

    <!-- Warning about conversion -->
    <Alert
      v-if="!internalValue && disabled"
      variant="destructive"
    >
      <AlertTriangle class="h-4 w-4" />
      <AlertTitle>Cannot Disable</AlertTitle>
      <AlertDescription>
        This collection already has encrypted points. To disable sensitive
        mode, you must first delete all encrypted points.
      </AlertDescription>
    </Alert>
  </div>
</template>


