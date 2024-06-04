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

dayjs.extend(localizedFormat)

const userService = useUserService()
const permissions = ref<Permission[]>([])

const columns: ColumnDef<Permission>[] = [
  {
    header: 'ID',
    accessorKey: 'id',
  },
  {
    header: 'Name',
    accessorKey: 'name',
  },
]

async function getPasskeys() {
  permissions.value = await userService.getPermissions()
}

onMounted(getPasskeys)
</script>

<template>
  <div class="flex w-full align-center justify-between">
    <H4 class="leading-loose">Permissions</H4>
  </div>

  <DataTable class="w-full" :columns="columns" :data="permissions"></DataTable>
</template>
