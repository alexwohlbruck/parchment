<script setup lang="ts">
import Users from '@/components/admin/Users.vue'
import { useAuthService } from '@/services/auth.service'
import { PermissionId } from '@/types/auth.types'

const authService = useAuthService()
</script>

<template>
  <Users v-if="authService.hasPermission(PermissionId.USERS_READ)" />
</template>
