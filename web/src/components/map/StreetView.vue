<template>
  <div ref="container" style="width: 100%; height: 100%"></div>
</template>

<script setup lang="ts">
import { Viewer, ViewerOptions } from 'mapillary-js'
import { ref, onMounted } from 'vue'

const container = ref()

onMounted(() => {
  if (!container.value) return

  const options: ViewerOptions = {
    accessToken: 'MLY|8412539762180196|434855eb0f16053c23bf1bd646efc90d',
    container: container.value,
    imageId: '498763468214164',
  }
  const viewer = new Viewer(options)
})
</script>
