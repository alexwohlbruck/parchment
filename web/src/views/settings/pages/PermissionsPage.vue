<script setup lang="ts">
import Permissions from '@/components/admin/Permissions.vue'
import { useAuthService } from '@/services/auth.service'
import { PermissionId } from '@/types/auth.types'

const authService = useAuthService()
</script>

<template>
  <Permissions v-if="authService.hasPermission(PermissionId.PERMISSIONS_READ)" />
</template>
