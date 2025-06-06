<script setup lang="ts">
import { h, onMounted, ref } from 'vue'
import dayjs from 'dayjs'
import localizedFormat from 'dayjs/plugin/localizedFormat'
import { ColumnDef } from '@tanstack/vue-table'
import { Permission, Role } from '@/types/auth.types'
import { useI18n } from 'vue-i18n'

import { useUserService } from '@/services/user.service'

import DataTable from '@/components/table/DataTable.vue'
import { Code } from '@/components/ui/code'
import { SettingsSection } from '@/components/settings'
const { t } = useI18n()

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
  <SettingsSection
    :title="t('settings.users.permissions.title')"
    :frame="false"
  >
    <DataTable
      class="w-full"
      :columns="columns"
      :data="permissions"
    ></DataTable>
  </SettingsSection>
</template>
