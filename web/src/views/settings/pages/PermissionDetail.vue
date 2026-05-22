<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import { useUserService } from '@/services/user.service'

import { H3, H5, Caption } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import Badge from '@/components/ui/badge/Badge.vue'
import { Code } from '@/components/ui/code'
import { ChevronLeftIcon } from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const userService = useUserService()
let permissionId = route.params.id as string

type PermissionDetail = {
  id: string
  name: string
  roles: {
    id: string
    name: string
    description: string
    isDefault: boolean
  }[]
}

const permission = ref<PermissionDetail | null>(null)
const loading = ref(true)

async function loadData() {
  loading.value = true
  try {
    permission.value = await userService.getPermission(permissionId)
  } finally {
    loading.value = false
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
      <!-- Associated roles -->
      <div>
        <H5 class="mb-3">
          Roles
          <Badge variant="secondary" class="ml-2">
            {{ permission.roles.length }}
          </Badge>
        </H5>
        <Card v-if="permission.roles.length > 0" class="p-0 overflow-hidden">
          <div class="divide-y divide-border">
            <button
              v-for="role in permission.roles"
              :key="role.id"
              class="w-full flex items-center gap-3 px-4 py-3 text-sm text-left hover:bg-muted/50 cursor-pointer"
              @click="onRoleClick(role.id)"
            >
              <span class="flex-1 min-w-0">
                <span class="font-medium">{{ role.name }}</span>
                <span v-if="role.description" class="text-muted-foreground ml-2">{{ role.description }}</span>
              </span>
              <Badge v-if="role.isDefault" variant="secondary">System</Badge>
            </button>
          </div>
        </Card>
        <Caption v-else class="text-muted-foreground">
          No roles have this permission
        </Caption>
      </div>
    </div>
  </div>
</template>
