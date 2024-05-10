<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Button } from '@/components/ui/button'
import { useAuthService } from '@/services/auth.service'

const authService = useAuthService()

type TODO = any

const passkeys = ref<TODO[]>([])

async function addPasskey() {
  const passkey = await authService.registerPasskey()
  passkeys.value.push(passkey)
}

async function getPasskeys() {
  passkeys.value = await authService.getPasskeys()
}

onMounted(getPasskeys)
</script>

<template>
  <Button @click="addPasskey()" variant="outline">Add passkey</Button>

  <p v-for="passkey in passkeys">{{ passkey.name }}</p>
</template>
