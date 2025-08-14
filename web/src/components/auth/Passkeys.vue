<script setup lang="ts">
import { h, onMounted, ref, computed } from 'vue'
import dayjs from 'dayjs'
import localizedFormat from 'dayjs/plugin/localizedFormat'
import { useI18n } from 'vue-i18n'
import { ColumnDef } from '@tanstack/vue-table'
import { Passkey } from '@/types/auth.types'

import { useAuthService } from '@/services/auth.service'
import { useAppService } from '@/services/app.service'
import { useResponsive } from '@/lib/utils'

import { H4 } from '@/components/ui/typography'
import DataTable from '@/components/table/DataTable.vue'
import { Button } from '@/components/ui/button'
import { SettingsSection } from '@/components/settings'
import { PlusIcon, Trash2Icon } from 'lucide-vue-next'

dayjs.extend(localizedFormat)

const appService = useAppService()
const authService = useAuthService()
const { t } = useI18n()
const { isTabletScreen } = useResponsive()
const passkeys = ref<Passkey[]>([])

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

  baseColumns.push({
    id: 'delete',
    cell: ({ row }) =>
      h(Button, {
        variant: 'outline',
        size: 'icon',
        icon: Trash2Icon,
        class: 'text-destructive',
        description: 'Delete session',
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
  if (name) {
    const passkey = await authService.registerPasskey(name)
    passkeys.value = [...passkeys.value, passkey]
  }
}

async function deletePasskey(passkeyId: string) {
  const confirmed = await appService.confirm({
    title: 'Delete this passkey?',
    description:
      'You will no longer be able to use this passkey to sign in on any device',
    destructive: true,
    continueText: 'Delete',
  })

  if (confirmed) {
    await authService.deletePasskey(passkeyId)
    passkeys.value = passkeys.value.filter(p => p.id !== passkeyId)
  }
}

async function getPasskeys() {
  passkeys.value = await authService.getPasskeys()
}

onMounted(getPasskeys)
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
