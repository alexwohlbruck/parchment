<script setup lang="ts">
import Roles from '@/components/admin/Roles.vue'
import { useAuthService } from '@/services/auth.service'
import { PermissionId } from '@/types/auth.types'

const authService = useAuthService()
</script>

<template>
  <Roles v-if="authService.hasPermission(PermissionId.ROLES_READ)" />
</template>
