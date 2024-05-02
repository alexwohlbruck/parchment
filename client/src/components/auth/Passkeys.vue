<script setup lang="ts">
import { ref } from 'vue'
import { Button } from '@/components/ui/button'
import { useAuthService } from '@/services/auth.service'

const authService = useAuthService()

const passkeys = ref<any[]>([])

async function addPasskey() {
  const passkey = await authService.registerPasskey()
  passkeys.value.push(passkey)
}
</script>

<template>
  <Button @click="addPasskey()" variant="outline">Add passkey</Button>

  <p v-for="passkey in passkeys">{{ passkey.id }}</p>
</template>
