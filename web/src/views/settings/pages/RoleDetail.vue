<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import { H3 } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'
import { ChevronLeftIcon } from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const roleId = route.params.id as string
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex items-center gap-2">
      <Button
        variant="ghost"
        size="icon"
        @click="router.push({ name: AppRoute.ROLES })"
      >
        <ChevronLeftIcon class="size-5" />
      </Button>
      <H3>Role detail</H3>
    </div>
    <p class="text-muted-foreground">Role ID: {{ roleId }}</p>
  </div>
</template>
