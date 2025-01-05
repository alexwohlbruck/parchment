<script setup lang="ts">
import { h, onMounted, ref } from 'vue'
import dayjs from 'dayjs'
import localizedFormat from 'dayjs/plugin/localizedFormat'
import { ColumnDef } from '@tanstack/vue-table'
import { Role } from '@/types/auth.types'

import { useUserService } from '@/services/user.service'

import { H4 } from '@/components/ui/typography'
import DataTable from '@/components/table/DataTable.vue'
import { Button } from '@/components/ui/button'
import { Trash2Icon } from 'lucide-vue-next'
import { Code } from '@/components/ui/code'
import { SettingsCard } from '@/components/settings'

dayjs.extend(localizedFormat)

const userService = useUserService()
const roles = ref<Role[]>([])

const columns: ColumnDef<Role>[] = [
  {
    header: 'ID',
    cell: ({ row }) => h(Code, {}, row.original.id),
  },
  {
    header: 'Name',
    accessorKey: 'name',
  },
  {
    header: 'Description',
    accessorKey: 'description',
  },
  {
    id: 'delete',
    cell: ({ row }) =>
      h(Button, {
        disabled: true, // TODO: User delete
        variant: 'outline',
        size: 'icon',
        icon: Trash2Icon,
        class: 'text-destructive',
        description: 'Delete user', // TODO: i18n
      }),
  },
]

async function getRoles() {
  roles.value = await userService.getRoles()
}

onMounted(getRoles)
</script>

<template>
  <SettingsCard :title="$t('settings.users.roles.title')" :frame="false">
    <DataTable class="w-full" :columns="columns" :data="roles"></DataTable>
  </SettingsCard>
</template>
