<script setup lang="ts">
import Users from '@/components/admin/Users.vue'
import Roles from '@/components/admin/Roles.vue'
import Permissions from '@/components/admin/Permissions.vue'
import { useAuthService } from '@/services/auth.service'
import { PermissionId as Permission } from '@/types/auth.types'

const authService = useAuthService()
</script>

<template>
  <div class="flex flex-col gap-4">
    <Users v-if="authService.hasPermission(Permission.USERS_READ)" />
    <Roles v-if="authService.hasPermission(Permission.ROLES_READ)" />
    <Permissions
      v-if="authService.hasPermission(Permission.PERMISSIONS_READ)"
    />
  </div>
</template>
