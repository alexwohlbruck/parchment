<script setup lang="ts">
import { h, onMounted, ref } from 'vue'
import dayjs from 'dayjs'
import localizedFormat from 'dayjs/plugin/localizedFormat'
import { ColumnDef } from '@tanstack/vue-table'
import { Permission, Role } from '@/types/auth.types'

import { useUserService } from '@/services/user.service'

import { H4 } from '@/components/ui/typography'
import DataTable from '@/components/table/DataTable.vue'
import { Button } from '@/components/ui/button'
import { Trash2Icon } from 'lucide-vue-next'
import { Code } from '@/components/ui/code'
import { SettingsCard } from '@/components/settings'

dayjs.extend(localizedFormat)

const userService = useUserService()
const permissions = ref<Permission[]>([])

const columns: ColumnDef<Permission>[] = [
  {
    header: 'ID',
    cell: ({ row }) => h(Code, {}, row.original.id),
  },
  {
    header: 'Name',
    accessorKey: 'name',
  },
]

async function getPermissions() {
  permissions.value = await userService.getPermissions()
}

onMounted(getPermissions)
</script>

<template>
  <SettingsCard :title="$t('settings.users.permissions.title')" :frame="false">
    <DataTable
      class="w-full"
      :columns="columns"
      :data="permissions"
    ></DataTable>
  </SettingsCard>
</template>
