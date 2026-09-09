<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import { useUserService } from '@/services/user.service'
import { useAuthService } from '@/services/auth.service'
import { PermissionId } from '@/types/auth.types'

import { H3, H5, Caption } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import Badge from '@/components/ui/badge/Badge.vue'
import { Checkbox } from '@/components/ui/checkbox'
import { Code } from '@/components/ui/code'
import { ChevronLeftIcon } from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const userService = useUserService()
const authService = useAuthService()
let permissionId = route.params.id as string

type RoleInfo = {
  id: string
  name: string
  description: string
  isDefault: boolean
}

type PermissionInfo = {
  id: string
  name: string
  roles: RoleInfo[]
}

const permission = ref<PermissionInfo | null>(null)
const allRoles = ref<RoleInfo[]>([])
const loading = ref(true)
const saving = ref(false)

const canWrite = computed(() =>
  authService.hasPermission(PermissionId.ROLES_WRITE),
)

const assignedRoleIds = computed<Set<string>>(() =>
  new Set((permission.value?.roles ?? []).map(r => r.id)),
)

async function loadData() {
  loading.value = true
  try {
    const [permData, roles] = await Promise.all([
      userService.getPermission(permissionId),
      userService.getRoles(),
    ])
    permission.value = permData
    allRoles.value = roles
  } finally {
    loading.value = false
  }
}

async function toggleRole(roleId: string, checked: boolean) {
  if (!canWrite.value) return

  saving.value = true
  try {
    // Fetch the role's current permissions
    const role = await userService.getRole(roleId)
    const currentPermIds = (role.permissions ?? []).map((p: any) => p.id as string)

    let newPermIds: string[]
    if (checked) {
      newPermIds = [...new Set([...currentPermIds, permissionId])]
    } else {
      newPermIds = currentPermIds.filter((id: string) => id !== permissionId)
    }

    await userService.setRolePermissions(roleId, newPermIds)
    // Reload to get fresh associated roles
    permission.value = await userService.getPermission(permissionId)
  } finally {
    saving.value = false
  }
}

function onRoleClick(roleId: string) {
  router.push({ name: AppRoute.ROLE_DETAIL, params: { id: roleId } })
}

watch(
  () => route.params.id,
  (newId) => {
    if (newId && newId !== permissionId) {
      permissionId = newId as string
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

  <div v-else-if="!permission" class="flex items-center justify-center py-12">
    <Caption class="text-muted-foreground">Permission not found</Caption>
  </div>

  <div v-else class="flex flex-col gap-6">
    <!-- Header -->
    <div class="flex items-start gap-4">
      <Button
        variant="ghost"
        size="icon"
        class="mt-1 shrink-0"
        @click="router.push({ name: AppRoute.PERMISSIONS_PAGE })"
      >
        <ChevronLeftIcon class="size-5" />
      </Button>
      <div class="flex-1 min-w-0">
        <H3 class="truncate">{{ permission.name }}</H3>
        <Code class="mt-1">{{ permission.id }}</Code>
      </div>
    </div>

    <div class="flex flex-col gap-6 ml-12">
      <!-- Roles -->
      <div>
        <H5 class="mb-3">
          Roles
          <Badge variant="secondary" class="ml-2">
            {{ assignedRoleIds.size }}
          </Badge>
        </H5>
        <Caption class="text-muted-foreground mb-3 block">
          Select which roles include this permission. System roles cannot be modified.
        </Caption>
        <Card class="p-0 overflow-hidden">
          <div class="divide-y divide-border">
            <label
              v-for="role in allRoles"
              :key="role.id"
              class="flex items-center gap-3 px-4 py-3 text-sm"
              :class="
                !role.isDefault && canWrite
                  ? 'cursor-pointer hover:bg-muted/50'
                  : 'cursor-default'
              "
            >
              <Checkbox
                :model-value="role.id === 'admin' || assignedRoleIds.has(role.id)"
                :disabled="role.isDefault || !canWrite || saving"
                @update:model-value="(v: any) => toggleRole(role.id, !!v)"
              />
              <span
                class="flex-1 min-w-0 cursor-pointer"
                @click.prevent="onRoleClick(role.id)"
              >
                <span class="font-medium hover:underline">{{ role.name }}</span>
                <span v-if="role.description" class="text-muted-foreground ml-2">{{ role.description }}</span>
              </span>
              <Badge v-if="role.isDefault" variant="secondary">System</Badge>
            </label>
          </div>
        </Card>
      </div>
    </div>
  </div>
</template>
