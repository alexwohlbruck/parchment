<script setup lang="ts">
import ky from 'ky'
import { startRegistration } from '@simplewebauthn/browser'
import { Button } from '@/components/ui/button'

type TODO = any

const passkeys = [
  {
    name: 'Bitwarden',
    created: new Date('2024-04-22T02:12:42Z'),
    lastUsed: new Date(),
  },
]

async function addPasskey() {
  const options = await ky
    .post(`http://localhost:5000/auth/webauthn/register/options`, {
      cache: 'no-store',
      credentials: 'include',
    })
    .json()

  let attestationResponse
  try {
    attestationResponse = await startRegistration(options)
  } catch (error: TODO) {
    console.error(error)
    if (error.name === 'InvalidStateError') {
      // TODO:
    } else {
      // TODO: Generic error
    }
  }

  const verificationResponse = await ky
    .post(`http://localhost:5000/auth/webauthn/register/verify`, {
      json: attestationResponse,
    })
    .json()

  if (verificationResponse?.verified) {
    alert('Success')
  } else {
    alert('error')
  }
}
</script>

<template>
  <Button @click="addPasskey()" variant="outline">Add passkey</Button>

  <p v-for="passkey in passkeys">{{ passkey.name }}</p>
</template>
