<script setup lang="ts">
import { useAuthStore } from '@/stores/auth.store'
import { storeToRefs } from 'pinia'
import { useAuthService } from '@/services/auth.service'
import Users from '@/components/admin/Users.vue'

const authService = useAuthService()
const authStore = useAuthStore()
const { me } = storeToRefs(authStore)
</script>

<template>
  <div class="flex flex-col gap-4">
    <Users />
  </div>
</template>
@/stores/auth
