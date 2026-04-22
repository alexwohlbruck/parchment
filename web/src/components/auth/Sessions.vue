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
        const osName = parsed?.getOS().name
        const browserName = parsed?.getBrowser().name
        // Collapse the noisy vendor/model/OS-version line into a clean
        // "macOS · Chrome" style summary. Apple pins OS version on the
        // web anyway, so showing the exact version is misleading.
        const label = [osName, browserName].filter(Boolean).join(' · ') || 'Unknown'
        const isCurrent = row.original.id === currentSessionId.value
        return h('div', { class: 'flex items-center gap-2' }, [
          h('span', {}, label),
          isCurrent
            ? h(Badge, { variant: 'success', class: 'text-xs' }, () => 'This device')
            : null,
        ])
      },
    },
  ]

  // Only include "signed in" column on non-mobile devices. Date-only
  // (`ll` → "Apr 22, 2026") is enough — the seconds-granular timestamp
  // was meaningless for users and clustered everything on the same day.
  if (!isTabletScreen.value) {
    baseColumns.push({
      id: 'signedInAt',
      header: 'Signed in',
      accessorFn: info => dayjs(info.createdAt as string).format('ll'),
    })
  }

  baseColumns.push({
    id: 'delete',
    cell: ({ row }) =>
      h(
        'div',
        { class: 'flex justify-end pl-4' },
        h(Button, {
          variant: 'destructive-outline',
          size: 'icon',
          icon: Trash2Icon,
          description: 'Sign out this session',
          onClick: () => deleteSession(row.original.id),
        }),
      ),
  })

  return baseColumns
})

async function deleteSession(sessionId: Session['id']) {
  const session = sessions.value.find(session => session.id === sessionId)!
  const parsed = session.userAgentParsed
  const browser = parsed?.getBrowser().name ?? 'this browser'
  const osName = parsed?.getOS().name ?? 'this device'
  const isCurrent = sessionId === currentSessionId.value

  const confirmed = await appService.confirm({
    title: isCurrent ? 'Sign out of this device?' : `Sign out of ${browser} on ${osName}?`,
    description: isCurrent
      ? "You're signed in here — continuing will sign you out immediately."
      : `You'll sign out ${browser} on ${osName}. You can sign back in later.`,
    destructive: true,
    continueText: 'Sign out',
  })

  if (confirmed) {
    await authService.deleteSession(sessionId)
    if (isCurrent) {
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
