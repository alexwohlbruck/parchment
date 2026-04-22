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
  PlusIcon,
  Trash2Icon,
  ShieldCheck,
  Shield,
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

const columns = computed<ColumnDef<Passkey>[]>(() => {
  const baseColumns: ColumnDef<Passkey>[] = [
    {
      header: 'Name',
      accessorKey: 'name',
    },
    {
      header: 'Backed Up',
      accessorFn: info => (info.backedUp ? t('general.yes') : t('general.no')),
    },
  ]

  // Only include created column on non-mobile devices
  if (!isTabletScreen.value) {
    baseColumns.push({
      header: 'Created',
      accessorFn: info => dayjs(info.createdAt as string).format('LLL'),
    })
  }

  // Recovery column. Shown only when the user has a local identity —
  // without it, slot enrollment would have nothing to wrap. Rows with an
  // existing slot get a green "Enabled" badge; rows without show an
  // "Enable" button that runs a PRF assertion on just that credential.
  baseColumns.push({
    id: 'recovery',
    header: 'Recovery',
    cell: ({ row }) => {
      if (!hasLocalIdentity.value) {
        return h(
          'span',
          { class: 'text-xs text-muted-foreground' },
          'Set up identity first',
        )
      }
      const enabled = passkeySlotCredentialIds.value.has(row.original.id)
      if (enabled) {
        return h(
          Badge,
          { variant: 'secondary', class: 'gap-1' },
          () => [
            h(ShieldCheck, { class: 'h-3 w-3' }),
            'Enabled',
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
          'Enable',
        ],
      )
    },
  })

  baseColumns.push({
    id: 'delete',
    cell: ({ row }) =>
      h(Button, {
        variant: 'destructive-outline',
        size: 'icon',
        icon: Trash2Icon,
        description: 'Delete passkey',
        onClick: () => deletePasskey(row.original.id),
      }),
  })

  return baseColumns
})

async function addPasskey() {
  const name = await appService.prompt({
    title: 'Create a passkey',
    label: 'Passkey name',
    inputProps: {
      placeholder: 'Eg. Keychain, Chrome, LastPass, Bitwarden',
    },
  })
  if (!name) return

  // If the user has a local identity already, enroll the passkey AND a
  // PRF recovery slot in one flow — that's the point of P0 #1. If no
  // local identity (shouldn't happen from Settings, but be safe), just
  // register the passkey as sign-in-only.
  if (identityStore.hasLocalIdentity) {
    // If the first ceremony doesn't emit a PRF output (happens on
    // older/cross-device authenticators), we need a second biometric
    // tap for recovery enrollment. Warn the user before Chrome
    // surprises them with another prompt.
    let secondTapToastId: string | number | undefined
    const result = await identityStore.enrollPasskey(name, {
      onSecondTapNeeded: () => {
        secondTapToastId = toast.info('One more tap to finish setup.', {
          duration: 8000,
        })
      },
    })
    if (secondTapToastId !== undefined) toast.dismiss(secondTapToastId)
    if (!result.success) {
      toast.error(result.error ?? "Couldn't add passkey")
      return
    }
    if (result.slotCreated) {
      toast.success('Passkey added. You can use it on any device.')
    } else {
      toast.warning(
        result.error ??
          "Passkey added, but it can't be used for recovery.",
      )
    }
    await getPasskeys()
    await identityStore.refreshSlotAvailability()
    return
  }

  // Fallback: no identity yet. Standard sign-in-only registration.
  const { passkey } = await authService.registerPasskey(name)
  passkeys.value = [...passkeys.value, passkey]
}

async function enableRecovery(credentialId: string) {
  busyCredentialId.value = credentialId
  try {
    const result = await identityStore.enrollExistingPasskey(credentialId)
    if (result.success && result.slotCreated) {
      toast.success('Recovery on. Use this passkey on any device.')
    } else if (result.success && !result.slotCreated) {
      toast.warning(result.error ?? "This passkey can't be used for recovery.")
    } else {
      toast.error(result.error ?? "Couldn't turn on recovery.")
    }
  } finally {
    busyCredentialId.value = null
  }
}

async function deletePasskey(passkeyId: string) {
  const confirmed = await appService.confirm({
    title: 'Delete this passkey?',
    description:
      'You will no longer be able to use this passkey to sign in on any device.',
    destructive: true,
    continueText: 'Delete',
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
    toast('Refresh account keys?', {
      description:
        "If this device was lost, refresh to keep your data safe. " +
        "You'll tap your other passkeys.",
      action: {
        label: 'Refresh',
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
    :title="$t('settings.account.passkeys.title')"
    :frame="false"
  >
    <template v-slot:actions>
      <Button @click="addPasskey()" variant="outline" :icon="PlusIcon">
        Add passkey
      </Button>
    </template>

    <DataTable class="w-full" :columns="columns" :data="passkeys"></DataTable>
  </SettingsSection>
</template>
