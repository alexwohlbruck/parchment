<script lang="ts" setup>
import { ref } from 'vue'
import type KeyboardShorcut from '../atoms/KeyboardShorcut.vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Card from 'primevue/card'

defineProps({
  visible: {
    type: Boolean,
    default: false
  }
})

const query = ref('')
</script>

<style lang="scss">
@import './linear.scss';
</style>

<template>
  <Dialog
    class="w-6 shadow-none gap-2"
    :visible="visible"
    @update:visible="$emit('update:visible', $event)"
    modal
  >
    <template #container="{ closeCallback }">
      <InputText class="w-full" v-model="query" size="large" placeholder="Search places..." />
      <Card>
        <template #content>
          <Button label="Cancel" @click="closeCallback" text></Button>
        </template>
      </Card>
    </template>
  </Dialog>
</template>
