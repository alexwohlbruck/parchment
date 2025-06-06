<script setup lang="ts">
import Users from '@/components/admin/Users.vue'
import Roles from '@/components/admin/Roles.vue'
import Permissions from '@/components/admin/Permissions.vue'
import { useAuthService } from '@/services/auth.service'
import { PermissionId } from '@/types/auth.types'

const authService = useAuthService()
</script>

<template>
  <div class="flex flex-col gap-4">
    <Users v-if="authService.hasPermission(PermissionId.USERS_READ)" />
    <Roles v-if="authService.hasPermission(PermissionId.ROLES_READ)" />
    <Permissions
      v-if="authService.hasPermission(PermissionId.PERMISSIONS_READ)"
    />
  </div>
</template>
