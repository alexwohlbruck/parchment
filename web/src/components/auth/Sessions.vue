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
import { useResponsive } from '@/lib/utils'
import { toast } from 'vue-sonner'

import { Session as OriginalSession } from '@/types/session.types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { H4 } from '@/components/ui/typography'
import { Trash2Icon, LogOutIcon } from 'lucide-vue-next'
import DataTable from '@/components/table/DataTable.vue'
import { SettingsSection } from '@/components/settings'
dayjs.extend(localizedFormat)

const authService = useAuthService()
const authStore = useAuthStore()
const appService = useAppService()
const { isTabletScreen } = useResponsive()

onMounted(authService.getSessions)

const { sessionId: currentSessionId, sessions: originalSessions } =
  storeToRefs(authStore)

function parseUAString(session: OriginalSession) {
  return {
    ...session,
    userAgentParsed: session.userAgent ? new UAParser(session.userAgent) : null,
  }
}

type Session = ReturnType<typeof parseUAString>

const sessions = computed(() => {
  return originalSessions.value.map(parseUAString)
})

// TODO: Store session in a pinia store
// TODO: Create computed getter with UAParser results

const columns = computed<ColumnDef<Session>[]>(() => {
  const baseColumns: ColumnDef<Session>[] = [
    {
      id: 'device',
      header: 'Device',
      cell: ({ row }) => {
        const parsed = row.original.userAgentParsed
        if (!parsed) return 'Unknown' // TODO: i18n
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
        const parsed = info.userAgentParsed
        if (!parsed) return 'Unknown' // TODO: i18n
        const { name, version } = parsed.getBrowser()
        return `${name} ${version}`
      },
    },
  ]

  // Only include created column on non-mobile devices
  if (!isTabletScreen.value) {
    baseColumns.push({
      id: 'created',
      header: 'Created',
      accessorFn: info => dayjs(info.createdAt as string).format('LLL'),
    })
  }

  baseColumns.push(
    // {
    //   id: 'expires',
    //   header: 'Expires',
    //   accessorFn: info => dayjs(info.expiresAt as string).format('LLL'),
    // },
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
          variant: 'destructive-outline',
          size: 'icon',
          icon: Trash2Icon,
          description: 'Delete session',
          onClick: () => deleteSession(row.original.id),
        }),
    },
  )

  return baseColumns
})

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

const hasOtherSessions = computed(() =>
  sessions.value.some(s => s.id !== currentSessionId.value),
)
const isSigningOutOthers = ref(false)

async function signOutOthers() {
  const confirmed = await appService.confirm({
    title: 'Sign out other devices?',
    description: "You'll stay signed in here. Recommended if a device was lost or stolen.",
    destructive: true,
    continueText: 'Sign out',
  })
  if (!confirmed) return

  isSigningOutOthers.value = true
  try {
    await authService.signOutOtherDevices()
    await authService.getSessions()
    toast.success('Signed out of other devices.')
  } catch (err) {
    toast.error(
      err instanceof Error ? err.message : "Couldn't sign out other devices.",
    )
  } finally {
    isSigningOutOthers.value = false
  }
}
</script>

<template>
  <SettingsSection
    :title="$t('settings.account.sessions.title')"
    :frame="false"
  >
    <template v-if="hasOtherSessions" v-slot:actions>
      <Button
        variant="destructive-outline"
        :icon="LogOutIcon"
        :disabled="isSigningOutOthers"
        @click="signOutOthers"
      >
        Sign out other devices
      </Button>
    </template>

    <DataTable class="w-full" :columns="columns" :data="sessions"></DataTable>
  </SettingsSection>
</template>
