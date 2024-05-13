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
const { sessionId: currentSessionId } = storeToRefs(authStore)

const columns: ColumnDef<Session>[] = [
  {
    id: 'device',
    header: 'Device',
    cell: ({ row }) => {
      const parsed = new UAParser(row.original.userAgent)
      const { vendor, model } = parsed.getDevice()
      const { name: osName, version: osVersion } = parsed.getOS()
      return h('div', {}, [
        h('span', {}, `${vendor} ${model}`),
        h('br'),
        h('span', { class: 'text-gray-500' }, `${osName} ${osVersion}`),
      ])
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
    id: 'created',
    header: 'Created',
    accessorFn: info => dayjs(info.createdAt as string).format('LLL'),
  },
  {
    id: 'expires',
    header: 'Expires',
    accessorFn: info => dayjs(info.expiresAt as string).format('LLL'),
  },
  {
    id: 'currentSession',
    cell: ({ row }) =>
      row.original.id === currentSessionId.value
        ? h(Badge, { class: 'chip', variant: 'outline' }, 'Current')
        : '',
  },
  {
    id: 'delete',
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
  if (confirm('Are you sure you want to delete this session?')) {
    await authService.deleteSession(sessionId)
    sessions.value = sessions.value.filter(session => session.id !== sessionId)
    if (sessionId === currentSessionId.value) {
      authService.signOut()
    }
  }
}

onMounted(getSessions)
</script>

<template>
  <div class="flex w-full align-center justify-between">
    <H4 class="leading-loose">Sessions</H4>
  </div>

  <DataTable class="w-full" :columns="columns" :data="sessions"></DataTable>
</template>
