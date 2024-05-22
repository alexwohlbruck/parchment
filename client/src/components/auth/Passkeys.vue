<script setup lang="ts">
import { h, onMounted, ref } from 'vue'
import dayjs from 'dayjs'
import localizedFormat from 'dayjs/plugin/localizedFormat'
import { ColumnDef } from '@tanstack/vue-table'
import { Passkey } from '@/types/auth.types'

import { useAuthService } from '@/services/auth.service'
import { useAppService } from '@/services/app.service'

import { H4 } from '@/components/ui/typography'
import DataTable from '@/components/table/DataTable.vue'
import { Button } from '@/components/ui/button'
import { PlusIcon, Trash2Icon } from 'lucide-vue-next'

dayjs.extend(localizedFormat)

const appService = useAppService()
const authService = useAuthService()
const passkeys = ref<Passkey[]>([])

const columns: ColumnDef<Passkey>[] = [
  {
    header: 'Name',
    accessorKey: 'name',
  },
  {
    header: 'Backed Up',
    accessorFn: info => (info.backedUp ? 'Yes' : 'No'),
  },
  {
    header: 'Created',
    accessorFn: info => dayjs(info.createdAt as string).format('LLL'),
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
        onClick: () => deletePasskey(row.original.id),
      }),
  },
]

async function addPasskey() {
  const name = prompt('Give your passkey a name')
  if (name) {
    const passkey = await authService.registerPasskey(name)
    passkeys.value = [...passkeys.value, passkey]
  }
}

async function deletePasskey(passkeyId) {
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
  <div class="flex w-full align-center justify-between">
    <H4 class="leading-loose">Passkeys</H4>

    <Button @click="addPasskey()" variant="outline" :icon="PlusIcon">
      Add passkey
    </Button>
  </div>

  <DataTable class="w-full" :columns="columns" :data="passkeys"></DataTable>
</template>
