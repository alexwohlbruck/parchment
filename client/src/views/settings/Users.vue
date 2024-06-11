<script setup lang="ts">
import Users from '@/components/admin/Users.vue'
import Roles from '@/components/admin/Roles.vue'
import Permissions from '@/components/admin/Permissions.vue'
import { useAuthService } from '@/services/auth.service'

const authService = useAuthService()
</script>

<template>
  <div class="flex flex-col gap-4">
    <Users v-if="authService.hasPermission('users:read')" />
    <Roles v-if="authService.hasPermission('roles:read')" />
    <Permissions v-if="authService.hasPermission('permissions:read')" />
  </div>
</template>
