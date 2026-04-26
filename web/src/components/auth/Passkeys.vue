<script setup lang="ts">
import { h, onMounted, ref, computed, watch } from 'vue'
import dayjs from 'dayjs'
import localizedFormat from 'dayjs/plugin/localizedFormat'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { ColumnDef } from '@tanstack/vue-table'
import { Passkey } from '@/types/auth.types'

import { useAuthService } from '@/services/auth.service'
import { useAppService } from '@/services/app.service'
import { useIdentityStore } from '@/stores/identity.store'
import { useResponsive } from '@/lib/utils'
import { toast } from 'vue-sonner'

import { H4 } from '@/components/ui/typography'
import DataTable from '@/components/table/DataTable.vue'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { SettingsSection } from '@/components/settings'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  PlusIcon,
  Trash2Icon,
  ShieldCheck,
  Shield,
  HelpCircle,
} from 'lucide-vue-next'

dayjs.extend(localizedFormat)

const appService = useAppService()
const authService = useAuthService()
const identityStore = useIdentityStore()
const { passkeySlotCredentialIds, hasLocalIdentity, passkeyListVersion } =
  storeToRefs(identityStore)
const { t } = useI18n()
const { isTabletScreen } = useResponsive()
const passkeys = ref<Passkey[]>([])

// Track which passkey (if any) is currently mid-enrollment — spinner on
// that row, disable the others' buttons so we don't pile up ceremonies.
const busyCredentialId = ref<string | null>(null)

// Reusable renderer for a column header with an info-icon tooltip.
// "Synced" in particular is jargon without the explanation — whether
// the passkey rides along with the user's password-manager cloud
// (iCloud, 1Password sync, etc.) vs. being pinned to the single device
// that created it. Using `h()` here lets us put Reka UI components
// inside an otherwise-string tanstack header.
function headerWithHelp(label: string, hint: string) {
  return () =>
    h(
      TooltipProvider,
      { delayDuration: 100 },
      () =>
        h(Tooltip, null, () => [
          h(
            TooltipTrigger,
            { asChild: true },
            () =>
              h(
                'span',
                { class: 'inline-flex items-center gap-1 cursor-help' },
                [
                  label,
                  h(HelpCircle, {
                    class: 'h-3 w-3 text-muted-foreground',
                    'aria-label': t('settings.auth.passkeys.columns.aboutLabel', { label }),
                  }),
                ],
              ),
          ),
          h(
            TooltipContent,
            { side: 'top', class: 'max-w-xs text-xs' },
            () => hint,
          ),
        ]),
    )
}

const columns = computed<ColumnDef<Passkey>[]>(() => {
  const baseColumns: ColumnDef<Passkey>[] = [
    {
      header: t('settings.auth.passkeys.columns.name'),
      accessorKey: 'name',
    },
    {
      id: 'synced',
      header: headerWithHelp(
        t('settings.auth.passkeys.columns.synced'),
        t('settings.auth.passkeys.columns.syncedHint'),
      ),
      accessorFn: info => (info.backedUp ? t('general.yes') : t('general.no')),
    },
  ]

  // Only include created column on non-mobile devices
  if (!isTabletScreen.value) {
    baseColumns.push({
      header: t('settings.auth.passkeys.columns.added'),
      accessorFn: info => dayjs(info.createdAt as string).format('ll'),
    })
  }

  // Recovery column. Shown only when the user has a local identity —
  // without it, slot enrollment would have nothing to wrap. Rows with an
  // existing slot get a prominent green "Recovery on" badge; rows without
  // show a neutral "Turn on" button that runs a PRF assertion for that
  // specific credential.
  baseColumns.push({
    id: 'recovery',
    header: t('settings.auth.passkeys.columns.recovery'),
    cell: ({ row }) => {
      if (!hasLocalIdentity.value) {
        return h(
          'span',
          { class: 'text-xs text-muted-foreground' },
          t('settings.auth.passkeys.setupIdentityFirst'),
        )
      }
      const enabled = passkeySlotCredentialIds.value.has(row.original.id)
      if (enabled) {
        return h(
          Badge,
          { variant: 'success', class: 'gap-1' },
          () => [
            h(ShieldCheck, { class: 'h-3 w-3' }),
            t('settings.auth.passkeys.recoveryOn'),
          ],
        )
      }
      const isBusy = busyCredentialId.value === row.original.id
      return h(
        Button,
        {
          size: 'sm',
          variant: 'outline',
          disabled: busyCredentialId.value !== null,
          onClick: () => enableRecovery(row.original.id),
        },
        () => [
          isBusy
            ? h(Spinner, { class: 'h-4 w-4 mr-2' })
            : h(Shield, { class: 'h-4 w-4 mr-2' }),
          t('settings.auth.passkeys.turnOn'),
        ],
      )
    },
  })

  // Delete action sits in its own trailing column with explicit left
  // padding so it doesn't look like a sibling of the Recovery action —
  // reducing the risk of a mis-click that blows away a working passkey.
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
          description: t('settings.auth.passkeys.deleteAction'),
          onClick: () => deletePasskey(row.original.id),
        }),
      ),
  })

  return baseColumns
})

async function addPasskey() {
  // No name prompt — the server auto-names from the AAGUID (iCloud
  // Keychain, 1Password, etc.) or falls back to "{OS} · {Browser}".
  // Passing an empty name here lets the server pick.

  if (identityStore.hasLocalIdentity) {
    // Enroll passkey AND its PRF recovery slot in one flow. If the
    // first ceremony doesn't emit a PRF output (older cross-device
    // authenticators), a second biometric tap is needed — warn via
    // toast so the extra prompt doesn't feel random.
    let secondTapToastId: string | number | undefined
    const result = await identityStore.enrollPasskey('', {
      onSecondTapNeeded: () => {
        secondTapToastId = toast.info(t('settings.auth.passkeys.secondTapToast'), {
          duration: 8000,
        })
      },
    })
    if (secondTapToastId !== undefined) toast.dismiss(secondTapToastId)
    if (result.cancelled) {
      // User hit Cancel on the biometric prompt. They know. Don't
      // spam them with an error toast — just bail.
      return
    }
    if (!result.success) {
      toast.error(result.error ?? t('settings.auth.passkeys.addErrorFallback'))
      return
    }
    if (result.slotCreated) {
      toast.success(t('settings.auth.passkeys.addSuccess'))
    } else {
      toast.warning(
        result.error ?? t('settings.auth.passkeys.addNoRecoveryFallback'),
      )
    }
    await getPasskeys()
    await identityStore.refreshSlotAvailability()
    return
  }

  // Fallback: no identity yet. Sign-in-only registration, still auto-named.
  const { passkey } = await authService.registerPasskey('')
  passkeys.value = [...passkeys.value, passkey]
}

async function enableRecovery(credentialId: string) {
  busyCredentialId.value = credentialId
  try {
    const result = await identityStore.enrollExistingPasskey(credentialId)
    if (result.cancelled) {
      // Cancellation is a user choice, not a failure. No toast.
      return
    }
    if (result.success && result.slotCreated) {
      toast.success(t('settings.auth.passkeys.recoveryOnSuccess'))
    } else if (result.success && !result.slotCreated) {
      toast.warning(result.error ?? t('settings.auth.passkeys.cannotUseForRecovery'))
    } else {
      toast.error(result.error ?? t('settings.auth.passkeys.recoveryFailedFallback'))
    }
  } finally {
    busyCredentialId.value = null
  }
}

async function deletePasskey(passkeyId: string) {
  const confirmed = await appService.confirm({
    title: t('settings.auth.passkeys.deleteConfirmTitle'),
    description: t('settings.auth.passkeys.deleteConfirmDescription'),
    destructive: true,
    continueText: t('general.delete'),
  })

  if (!confirmed) return

  await authService.deletePasskey(passkeyId)
  passkeys.value = passkeys.value.filter(p => p.id !== passkeyId)
  await identityStore.refreshSlotAvailability()

  // Deleting a passkey cascade-deletes its recovery slot. To be safe
  // against any material previously observed by an attacker (e.g. a
  // server-side DB dump), offer to rotate the master key. The user can
  // also rotate later from Identity settings.
  if (identityStore.isSetupComplete) {
    toast(t('settings.auth.passkeys.refreshKeysTitle'), {
      description: t('settings.auth.passkeys.refreshKeysDescription'),
      action: {
        label: t('settings.auth.passkeys.refreshKeysAction'),
        onClick: () => identityStore.requestRotateKeys(),
      },
      duration: 15000,
    })
  }
}

async function getPasskeys() {
  passkeys.value = await authService.getPasskeys()
}

onMounted(async () => {
  await getPasskeys()
  // Fire-and-forget: populate slot list so Recovery column renders the
  // right state without blocking the initial render.
  identityStore.refreshSlotAvailability()
})

// A passkey can be enrolled from places other than this component —
// e.g. the "Add passkey" step inside the Set Up Federation Identity
// dialog. When that happens the store bumps `passkeyListVersion`; we
// refetch so the row appears without a page reload.
watch(passkeyListVersion, async () => {
  await getPasskeys()
  await identityStore.refreshSlotAvailability()
})
</script>

<template>
  <SettingsSection
    id="passkeys"
    :title="$t('settings.account.passkeys.title')"
    :frame="false"
  >
    <template v-slot:actions>
      <Button @click="addPasskey()" variant="outline" :icon="PlusIcon">
        {{ t('settings.auth.passkeys.addPasskey') }}
      </Button>
    </template>

    <DataTable class="w-full" :columns="columns" :data="passkeys"></DataTable>
  </SettingsSection>
</template>
