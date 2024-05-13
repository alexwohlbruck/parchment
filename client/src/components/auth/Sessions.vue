<script setup lang="ts">
import { onMounted, ref } from 'vue'
import dayjs from 'dayjs'
import localizedFormat from 'dayjs/plugin/localizedFormat'
import { Button } from '@/components/ui/button'
import { useAuthService } from '@/services/auth.service'
import { H4 } from '@/components/ui/typography'
import DataTable from '@/components/table/DataTable.vue'
import UAParser from 'ua-parser-js'

dayjs.extend(localizedFormat)

const authService = useAuthService()

type Passkey = {
  id: string
  userId: string
  expiresAt: string
  userAgent?: string
  ipv4?: string
}

const sessions = ref<Passkey[]>([])

const columns = [
  {
    header: 'Device',
    accessorFn: info => {
      const parsed = new UAParser(info.userAgent)
      const { vendor, model } = parsed.getDevice()
      const { name: osName, version: osVersion } = parsed.getOS()
      return `${vendor} ${model} - ${osName} ${osVersion}`
    },
  },
  {
    header: 'Browser',
    accessorFn: info => {
      const { name, version } = new UAParser(info.userAgent).getBrowser()
      return `${name} ${version}`
    },
  },
  {
    header: 'Expires',
    accessorFn: info => dayjs(info.expiresAt as string).format('LLL'),
  },
]

async function getSessions() {
  sessions.value = await authService.getSessions()
}

onMounted(getSessions)
</script>

<template>
  <div class="flex w-full align-center justify-between">
    <H4 class="leading-loose">Sessions</H4>
  </div>

  <DataTable class="w-full" :columns="columns" :data="sessions"></DataTable>
</template>
