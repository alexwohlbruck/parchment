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
import DeleteConfirmForm from '@/components/admin/DeleteConfirmForm.vue'
import DataTable from '@/components/table/DataTable.vue'
import { Button } from '@/components/ui/button'
import { Code } from '@/components/ui/code'
import Badge from '@/components/ui/badge/Badge.vue'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { SettingsSection } from '@/components/settings'
import { PlusIcon, EllipsisVerticalIcon, Trash2Icon } from 'lucide-vue-next'

const router = useRouter()
const userService = useUserService()
const appService = useAppService()
const authService = useAuthService()
const { isTabletScreen } = useResponsive()
const roles = ref<Role[]>([])

const canWrite = computed(() =>
  authService.hasPermission(PermissionId.ROLES_WRITE),
)
const canDelete = computed(() =>
  authService.hasPermission(PermissionId.ROLES_DELETE),
)

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

  if (canWrite.value || canDelete.value) {
    baseColumns.push({
      id: 'actions',
      meta: {
        headerClass: 'w-10',
        cellClass: 'text-center',
      },
      cell: ({ row }) => {
        const isDefault = (row.original as any).isDefault
        if (isDefault) return null

        const items: any[] = []

        if (canDelete.value) {
          items.push(
            h(
              DropdownMenuItem,
              {
                class: 'text-destructive',
                onClick: () => deleteRole(row.original),
              },
              () => [h(Trash2Icon, { class: 'size-4 mr-2' }), 'Delete'],
            ),
          )
        }

        if (items.length === 0) return null

        return h(
          DropdownMenu,
          {},
          {
            default: () => [
              h(DropdownMenuTrigger, { asChild: true }, () =>
                h(Button, {
                  variant: 'ghost',
                  size: 'icon-sm',
                  icon: EllipsisVerticalIcon,
                  onClick: (e: MouseEvent) => e.stopPropagation(),
                }),
              ),
              h(DropdownMenuContent, { align: 'end' }, () => items),
            ],
          },
        )
      },
    })
  }

  return baseColumns
})

const allPermissions = ref<Permission[]>([])

async function getRoles() {
  roles.value = await userService.getRoles()
}

async function loadPermissions() {
  allPermissions.value = await userService.getPermissions()
}

async function deleteRole(role: Role) {
  const confirmed = await appService.componentDialog({
    component: DeleteConfirmForm,
    props: {
      confirmValue: role.id,
      warning: 'This action cannot be undone.',
    },
    title: `Delete "${role.name}"?`,
    description:
      'This role will be permanently deleted and unassigned from all users.',
    destructive: true,
    contentClass: 'md:max-w-md lg:max-w-md',
    continueText: 'Delete',
  })
  if (!confirmed) return

  try {
    await userService.deleteRole(role.id)
    await getRoles()
    appService.toast.success('Role deleted')
  } catch (err: any) {
    appService.toast.error(
      err?.response?.data?.message ?? 'Failed to delete role',
    )
  }
}

async function createRole() {
  if (!allPermissions.value.length) await loadPermissions()

  const result = await appService.componentDialog({
    component: RoleForm,
    props: {
      permissions: allPermissions.value,
      existingRoleIds: roles.value.map(r => r.id),
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
