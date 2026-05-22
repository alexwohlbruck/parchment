<script setup lang="ts">
import { h, onMounted, ref, computed } from 'vue'
import { ColumnDef } from '@tanstack/vue-table'
import { Role, Permission, PermissionId } from '@/types/auth.types'
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import { useResponsive } from '@/lib/utils'
import { useUserService } from '@/services/user.service'
import { useAppService } from '@/services/app.service'
import { useAuthService } from '@/services/auth.service'

import RoleForm from '@/components/admin/RoleForm.vue'
import DataTable from '@/components/table/DataTable.vue'
import { Button } from '@/components/ui/button'
import { Code } from '@/components/ui/code'
import Badge from '@/components/ui/badge/Badge.vue'
import { SettingsSection } from '@/components/settings'
import { PlusIcon } from 'lucide-vue-next'

const router = useRouter()
const userService = useUserService()
const appService = useAppService()
const authService = useAuthService()
const { isTabletScreen } = useResponsive()
const roles = ref<Role[]>([])

const columns = computed<ColumnDef<Role>[]>(() => {
  const baseColumns: ColumnDef<Role>[] = []

  baseColumns.push({
    header: 'ID',
    cell: ({ row }) => h(Code, {}, row.original.id),
  })

  baseColumns.push({
    header: 'Name',
    accessorKey: 'name',
  })

  if (!isTabletScreen.value) {
    baseColumns.push({
      header: 'Description',
      accessorKey: 'description',
    })
  }

  baseColumns.push({
    id: 'type',
    header: 'Type',
    cell: ({ row }) =>
      h(
        Badge,
        { variant: (row.original as any).isDefault ? 'secondary' : 'outline' },
        (row.original as any).isDefault ? 'System' : 'Custom',
      ),
  })

  return baseColumns
})

const allPermissions = ref<Permission[]>([])

async function getRoles() {
  roles.value = await userService.getRoles()
}

async function loadPermissions() {
  allPermissions.value = await userService.getPermissions()
}

async function createRole() {
  if (!allPermissions.value.length) await loadPermissions()

  const result = await appService.componentDialog({
    component: RoleForm,
    props: {
      permissions: allPermissions.value,
    },
    title: 'Create role',
    continueText: 'Create',
  })

  if (!result) return

  await userService.createRole(result)
  await getRoles()
  appService.toast.success('Role created')
}

function onRowClick(role: Role) {
  router.push({ name: AppRoute.ROLE_DETAIL, params: { id: role.id } })
}

onMounted(getRoles)
</script>

<template>
  <SettingsSection
    id="roles"
    :title="$t('settings.users.roles.title')"
    :frame="false"
  >
    <template v-slot:actions>
      <Button
        v-if="authService.hasPermission(PermissionId.ROLES_CREATE)"
        @click="createRole()"
        variant="outline"
        :icon="PlusIcon"
      >
        Create role
      </Button>
    </template>

    <DataTable
      class="w-full"
      :columns="columns"
      :data="roles"
      :page-size="10"
      :on-row-click="onRowClick"
    />
  </SettingsSection>
</template>
