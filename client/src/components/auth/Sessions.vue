<script setup lang="ts">
import { onMounted, ref, h, computed } from 'vue'
import dayjs from 'dayjs'
import localizedFormat from 'dayjs/plugin/localizedFormat'
import UAParser from 'ua-parser-js'
import { storeToRefs } from 'pinia'
import { ColumnDef } from '@tanstack/vue-table'

import { DialogType } from '@/types/app.types'
import { useAppService } from '@/services/app.service'
import { useAuthService } from '@/services/auth.service'
import { useAuthStore } from '@/stores/auth.store'

import { Session as OriginalSession } from '@/types/session.types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { H4 } from '@/components/ui/typography'
import { Trash2Icon } from 'lucide-vue-next'
import DataTable from '@/components/table/DataTable.vue'

dayjs.extend(localizedFormat)

const authService = useAuthService()
const authStore = useAuthStore()
const appService = useAppService()

onMounted(authService.getSessions)

const { sessionId: currentSessionId, sessions: originalSessions } =
  storeToRefs(authStore)

function parseUAString(session: OriginalSession) {
  return {
    ...session,
    userAgentParsed: new UAParser(session.userAgent),
  }
}

type Session = ReturnType<typeof parseUAString>

const sessions = computed(() => {
  return originalSessions.value.map(parseUAString)
})

// TODO: Store session in a pinia store
// TODO: Create computed getter with UAParser results

const columns: ColumnDef<Session>[] = [
  {
    id: 'device',
    header: 'Device',
    cell: ({ row }) => {
      const parsed = row.original.userAgentParsed
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
      const { name, version } = info.userAgentParsed.getBrowser()
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

async function deleteSession(sessionId: Session['id']) {
  const session = sessions.value.find(session => session.id === sessionId)!
  const browser = session.userAgentParsed.getBrowser().name
  const device = session.userAgentParsed.getDevice().model

  const confirmed = await appService.confirm({
    title: 'Delete this session?',
    description: `You will be signed out of ${browser} on your ${device}`,
    destructive: true,
    continueText: 'Delete',
  })

  if (confirmed) {
    await authService.deleteSession(sessionId)
    if (sessionId === currentSessionId.value) {
      authService.signOut()
    }
  }
}
</script>

<template>
  <div class="flex w-full align-center justify-between">
    <H4 class="leading-loose">Sessions</H4>
  </div>

  <DataTable class="w-full" :columns="columns" :data="sessions"></DataTable>
</template>
