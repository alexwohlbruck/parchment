<script setup lang="ts">
import H3 from '@/components/ui/typography/H3.vue'
import H4 from '@/components/ui/typography/H4.vue'
import Avatar from '@/components/ui/avatar/Avatar.vue'
import AvatarImage from '@/components/ui/avatar/AvatarImage.vue'
import Button from '@/components/ui/button/Button.vue'

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

const passkeys = [
  {
    name: 'Bitwarden',
    created: new Date('2024-04-22T02:12:42Z'),
    lastUsed: new Date(),
  },
]
</script>

<template>
  <div class="flex flex-col gap-4">
    <H3>{{ $t('settings.account.title') }}</H3>

    <div class="flex items-center gap-2 w-full">
      <Avatar size="sm">
        <AvatarImage
          src="https://github.com/alexwohlbruck.png"
          alt="@alexwohlbruck"
        />
      </Avatar>

      <div class="flex flex-col text-nowrap">
        <span class="text-sm font-semibold leading-4">Alex Wohlbruck</span>
        <span class="text-xs text-gray-500 leading-4">Admin</span>
      </div>

      <div class="flex-1"></div>

      <Button variant="outline">Sign out</Button>
    </div>

    <H4>Sessions</H4>

    <p v-for="session in sessions">{{ session.deviceName }}</p>

    <H4>Passkeys</H4>

    <p v-for="passkey in passkeys">{{ passkey.name }}</p>
  </div>
</template>
