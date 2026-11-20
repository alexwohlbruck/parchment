<script setup lang="ts">
import { ref } from 'vue'
import AvatarCropDialog from './AvatarCropDialog.vue'

const emit = defineEmits<{ crop: [image: Blob] }>()

const input = ref<HTMLInputElement | null>(null)
const file = ref<File | null>(null)
const cropOpen = ref(false)

function choose() {
  input.value?.click()
}

function onFileChange() {
  const picked = input.value?.files?.[0]
  if (input.value) input.value.value = ''
  if (!picked) return
  file.value = picked
  cropOpen.value = true
}
</script>

<template>
  <slot :choose="choose" />
  <input ref="input" type="file" accept="image/*" class="hidden" @change="onFileChange" />
  <AvatarCropDialog v-model:open="cropOpen" :file="file" @crop="emit('crop', $event)" />
</template>
