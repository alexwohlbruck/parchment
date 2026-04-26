<script setup lang="ts">
import { h, onMounted, ref, computed } from 'vue'
import dayjs from 'dayjs'
import localizedFormat from 'dayjs/plugin/localizedFormat'
import { ColumnDef } from '@tanstack/vue-table'
import { Role } from '@/types/auth.types'
import { useResponsive } from '@/lib/utils'

import { useUserService } from '@/services/user.service'

import { H4 } from '@/components/ui/typography'
import DataTable from '@/components/table/DataTable.vue'
import { Button } from '@/components/ui/button'
import { Trash2Icon } from 'lucide-vue-next'
import { Code } from '@/components/ui/code'
import { SettingsSection } from '@/components/settings'

dayjs.extend(localizedFormat)

const userService = useUserService()
const { isTabletScreen } = useResponsive()
const roles = ref<Role[]>([])

const columns = computed<ColumnDef<Role>[]>(() => {
  const baseColumns: ColumnDef<Role>[] = []

  // ID column (always visible)
  baseColumns.push({
    header: 'ID',
    cell: ({ row }) => h(Code, {}, row.original.id),
  })

  // Name column (always visible)
  baseColumns.push({
    header: 'Name',
    accessorKey: 'name',
  })

  // Description column (desktop only)
  if (!isTabletScreen.value) {
    baseColumns.push({
      header: 'Description',
      accessorKey: 'description',
    })
  }

  // Delete column (always visible)
  baseColumns.push({
    id: 'delete',
    cell: ({ row }) =>
      h(Button, {
        disabled: true, // TODO: User delete
        variant: 'destructive-outline',
        size: 'icon',
        icon: Trash2Icon,
        description: 'Delete user', // TODO: i18n
      }),
  })

  return baseColumns
})

async function getRoles() {
  roles.value = await userService.getRoles()
}

onMounted(getRoles)
</script>

<template>
  <SettingsSection
    id="roles"
    :title="$t('settings.users.roles.title')"
    :frame="false"
  >
    <DataTable class="w-full" :columns="columns" :data="roles"></DataTable>
  </SettingsSection>
</template>
