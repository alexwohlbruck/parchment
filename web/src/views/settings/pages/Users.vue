<script setup lang="ts">
import UserTable from '@/components/admin/UserTable.vue'
import { useAuthService } from '@/services/auth.service'
import { PermissionId } from '@/types/auth.types'

const authService = useAuthService()
</script>

<template>
  <UserTable v-if="authService.hasPermission(PermissionId.USERS_READ)" />
</template>
