<script setup lang="ts">
import { useAuthStore } from '@/stores/auth.store'
import Users from '@/components/admin/Users.vue'
import Roles from '@/components/admin/Roles.vue'
import Permissions from '@/components/admin/Permissions.vue'
</script>

<template>
  <div class="flex flex-col gap-4">
    <Users />
    <Roles />
    <Permissions />
  </div>
</template>
@/stores/auth
