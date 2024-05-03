<script setup lang="ts">
import { H4 } from '@/components/ui/typography'
import { Avatar, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import SigninForm from '@/components/auth/SigninForm.vue'
import Passkeys from '@/components/auth/Passkeys.vue'
import { useUserStore } from '@/stores/user.store'
import { storeToRefs } from 'pinia'
import { useAuthService } from '@/services/auth.service'

const authService = useAuthService()
const userStore = useUserStore()
const { me } = storeToRefs(userStore)

const sessions = [
  {
    deviceName: 'Pixel 8 Pro',
    ipAddress: '172.217.22.14',
  },
  {
    deviceName: 'Macbook Air',
    ipAddress: '172.217.22.14',
  },
]
</script>

<template>
  <div class="flex flex-col gap-4">
    <SigninForm v-if="!me" />

    <template v-else>
      <div class="flex items-center gap-2 w-full">
        <Avatar v-if="me.picture" size="sm">
          <AvatarImage :src="me.picture" :alt="me.email" />
        </Avatar>

        <div class="flex flex-col text-nowrap">
          <span class="text-sm font-semibold leading-4">
            {{ me.firstName }} {{ me.lastName }}
          </span>
          <span class="text-xs text-gray-500 leading-4">Admin</span>
        </div>

        <div class="flex-1"></div>

        <Button variant="outline" @click="authService.signOut()">
          Sign out
        </Button>
      </div>

      <H4>Sessions</H4>

      <p v-for="session in sessions">{{ session.deviceName }}</p>

      <H4>Passkeys</H4>

      <Passkeys />
    </template>
  </div>
</template>
