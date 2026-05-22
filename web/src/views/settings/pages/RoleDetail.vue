<script setup lang="ts">
import { h, ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { ColumnDef } from '@tanstack/vue-table'
import { AppRoute } from '@/router'
import { useUserService } from '@/services/user.service'
import { useAppService } from '@/services/app.service'
import { useAuthService } from '@/services/auth.service'
import { PermissionId, type Permission } from '@/types/auth.types'

import { H3, H5, Caption } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import Badge from '@/components/ui/badge/Badge.vue'
import { Checkbox } from '@/components/ui/checkbox'
import Avatar from '@/components/ui/avatar/Avatar.vue'
import AvatarImage from '@/components/ui/avatar/AvatarImage.vue'
import DataTable from '@/components/table/DataTable.vue'
import {
  ChevronLeftIcon,
  PencilIcon,
  Trash2Icon,
} from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const appService = useAppService()
const authService = useAuthService()
const userService = useUserService()
let roleId = route.params.id as string

const role = ref<any>(null)
const allPermissions = ref<Permission[]>([])
const loading = ref(true)
const saving = ref(false)

const isSystem = computed(() => role.value?.isDefault ?? true)
const isAdmin = computed(() => roleId === 'admin')

const canWrite = computed(() =>
  authService.hasPermission(PermissionId.ROLES_WRITE),
)
const canDelete = computed(() =>
  authService.hasPermission(PermissionId.ROLES_DELETE),
)

const rolePermissionIds = computed<Set<string>>(() =>
  new Set((role.value?.permissions ?? []).map((p: any) => p.id as string)),
)

async function loadData() {
  loading.value = true
  try {
    const [roleData, perms] = await Promise.all([
      userService.getRole(roleId),
      userService.getPermissions(),
    ])
    role.value = roleData
    allPermissions.value = perms
  } finally {
    loading.value = false
  }
}

async function togglePermission(permId: string, checked: boolean) {
  if (isSystem.value || !canWrite.value) return

  saving.value = true
  try {
    const current = new Set(rolePermissionIds.value)
    if (checked) {
      current.add(permId)
    } else {
      current.delete(permId)
    }
    await userService.setRolePermissions(roleId, Array.from(current))
    role.value = await userService.getRole(roleId)
  } finally {
    saving.value = false
  }
}

async function deleteRole() {
  if (!role.value || isSystem.value) return
  const userCount = role.value.users?.length ?? 0

  const confirmed = await appService.componentDialog({
    component: (await import('@/components/admin/DeleteConfirmForm.vue')).default,
    props: {
      confirmValue: roleId,
      label: `Type the role ID to confirm deletion.`,
    },
    title: `Delete "${role.value.name}"?`,
    description: userCount > 0
      ? `This will unassign ${userCount} user${userCount === 1 ? '' : 's'} from this role and permanently delete it.`
      : 'This role will be permanently deleted.',
    destructive: true,
    contentClass: 'md:max-w-sm lg:max-w-sm',
    continueText: 'Delete',
  })
  if (!confirmed) return

  try {
    await userService.deleteRole(roleId)
    appService.toast.success('Role deleted')
    router.push({ name: AppRoute.ROLES })
  } catch (err: any) {
    appService.toast.error(err?.response?.data?.message ?? 'Failed to delete role')
  }
}

async function editRole() {
  if (!role.value || isSystem.value || !canWrite.value) return

  const { z } = await import('zod')
  const schema = z.object({
    name: z.string().min(1).describe('Name'),
    description: z.string().describe('Description'),
  })

  const result = (await appService.promptForm({
    title: `Edit role`,
    schema,
    initialValues: {
      name: role.value.name,
      description: role.value.description,
    },
  })) as { name: string; description: string } | false

  if (!result) return

  try {
    await userService.updateRole(roleId, result)
    role.value = await userService.getRole(roleId)
    appService.toast.success('Role updated')
  } catch (err: any) {
    appService.toast.error(err?.response?.data?.message ?? 'Failed to update role')
  }
}

type AssignedUser = {
  id: string
  firstName: string
  lastName: string
  email: string
  picture: string | null
}

const userColumns: ColumnDef<AssignedUser>[] = [
  {
    id: 'avatar',
    cell: ({ row }) =>
      h(Avatar, { class: 'size-8' }, () => [
        h(AvatarImage, { src: row.original.picture || '' }),
      ]),
    meta: { headerClass: 'w-12' },
  },
  {
    header: 'Name',
    accessorFn: (data) => `${data.firstName} ${data.lastName}`,
  },
  {
    header: 'Email',
    accessorKey: 'email',
  },
]

function onUserRowClick(user: AssignedUser) {
  router.push({ name: AppRoute.USER_DETAIL, params: { id: user.id } })
}

watch(
  () => route.params.id,
  (newId) => {
    if (newId && newId !== roleId) {
      roleId = newId as string
      loadData()
    }
  },
)

onMounted(loadData)
</script>

<template>
  <div v-if="loading" class="flex items-center justify-center py-12">
    <Caption class="text-muted-foreground">Loading...</Caption>
  </div>

  <div v-else-if="!role" class="flex items-center justify-center py-12">
    <Caption class="text-muted-foreground">Role not found</Caption>
  </div>

  <div v-else class="flex flex-col gap-6">
    <!-- Header -->
    <div class="flex items-start gap-4">
      <Button
        variant="ghost"
        size="icon"
        class="mt-1 shrink-0"
        @click="router.push({ name: AppRoute.ROLES })"
      >
        <ChevronLeftIcon class="size-5" />
      </Button>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-3">
          <H3 class="truncate">{{ role.name }}</H3>
          <Badge v-if="isSystem" variant="secondary">System</Badge>
        </div>
        <Caption v-if="role.description" class="text-muted-foreground">
          {{ role.description }}
        </Caption>
      </div>
      <div v-if="!isSystem" class="flex gap-2 shrink-0">
        <Button
          v-if="canWrite"
          variant="outline"
          size="sm"
          :icon="PencilIcon"
          @click="editRole"
        >
          Edit
        </Button>
        <Button
          v-if="canDelete"
          variant="destructive-outline"
          size="sm"
          :icon="Trash2Icon"
          @click="deleteRole"
        >
          Delete
        </Button>
      </div>
    </div>

    <div class="flex flex-col gap-6 ml-12">
      <!-- Permissions -->
      <div>
        <H5 class="mb-3">Permissions</H5>
        <Caption
          v-if="isAdmin"
          class="text-muted-foreground mb-3 block"
        >
          Administrators have all permissions
        </Caption>
        <Caption
          v-else-if="isSystem"
          class="text-muted-foreground mb-3 block"
        >
          System role permissions cannot be modified
        </Caption>
        <Card class="p-0 overflow-hidden">
          <div class="divide-y divide-border">
            <label
              v-for="perm in allPermissions"
              :key="perm.id"
              class="flex items-center gap-3 px-4 py-3 text-sm"
              :class="
                !isSystem && canWrite
                  ? 'cursor-pointer hover:bg-muted/50'
                  : 'cursor-default'
              "
            >
              <Checkbox
                :model-value="isAdmin || rolePermissionIds.has(perm.id)"
                :disabled="isSystem || !canWrite || saving"
                @update:model-value="(v: any) => togglePermission(perm.id, !!v)"
              />
              <span class="flex-1 min-w-0">
                <span class="font-medium">{{ perm.name }}</span>
                <span class="text-muted-foreground ml-2">{{ perm.id }}</span>
              </span>
            </label>
          </div>
        </Card>
      </div>

      <!-- Assigned users -->
      <div v-if="role.users?.length > 0">
        <H5 class="mb-3">
          Assigned users
          <Badge variant="secondary" class="ml-2">
            {{ role.users.length }}
          </Badge>
        </H5>
        <DataTable
          :columns="userColumns"
          :data="role.users"
          :page-size="10"
          :on-row-click="onUserRowClick"
        />
      </div>
    </div>
  </div>
</template>
