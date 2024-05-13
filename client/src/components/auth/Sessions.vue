<script setup lang="ts">
import { onMounted, ref } from 'vue'
import dayjs from 'dayjs'
import localizedFormat from 'dayjs/plugin/localizedFormat'
import { Session } from '@/types/session.types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useAuthService } from '@/services/auth.service'
import { H4 } from '@/components/ui/typography'
import DataTable from '@/components/table/DataTable.vue'
import UAParser from 'ua-parser-js'
import { ColumnDef } from '@tanstack/vue-table'
import { h } from 'vue'
import { Trash2Icon } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { useAuthStore } from '@/stores/auth.store'

dayjs.extend(localizedFormat)

const authService = useAuthService()
const authStore = useAuthStore()

const sessions = ref<Session[]>([])
const { sessionId } = storeToRefs(authStore)

const columns: ColumnDef<Session>[] = [
  {
    id: 'device',
    header: 'Device',
    accessorFn: info => {
      const parsed = new UAParser(info.userAgent)
      const { vendor, model } = parsed.getDevice()
      const { name: osName, version: osVersion } = parsed.getOS()
      return `${vendor} ${model} - ${osName} ${osVersion}`
    },
  },
  {
    id: 'browser',
    header: 'Browser',
    accessorFn: info => {
      const { name, version } = new UAParser(info.userAgent).getBrowser()
      return `${name} ${version}`
    },
  },
  {
    id: 'expires',
    header: 'Expires',
    accessorFn: info => dayjs(info.expiresAt as string).format('LLL'),
  },
  {
    id: 'currentSession',
    cell: ({ row }) =>
      row.original.id === sessionId.value
        ? h(Badge, { class: 'chip', variant: 'outline' }, 'Current')
        : '',
  },
  {
    // Render delete button
    id: 'actions',
    cell: ({ row }) =>
      h(Button, {
        variant: 'outline',
        size: 'icon',
        icon: Trash2Icon,
        class: 'text-destructive',
        description: 'Delete session',
        onClick: () => deleteSession(row.original.id),
      }),
  },
]

async function getSessions() {
  sessions.value = await authService.getSessions()
}

async function deleteSession(sessionId: Session['id']) {
  await authService.deleteSession(sessionId)
  sessions.value = sessions.value.filter(session => session.id !== sessionId)
}

onMounted(getSessions)
</script>

<template>
  <div class="flex w-full align-center justify-between">
    <H4 class="leading-loose">Sessions</H4>
  </div>

  <DataTable class="w-full" :columns="columns" :data="sessions"></DataTable>
</template>
