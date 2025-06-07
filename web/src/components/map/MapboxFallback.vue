<script setup lang="ts">
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Settings } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import { siMapbox } from 'simple-icons'
import BrandIcon from '@/components/ui/brand-icon/BrandIcon.vue'

const router = useRouter()

function navigateToIntegrations() {
  router.push({ name: AppRoute.INTEGRATIONS })
}
</script>

<template>
  <div class="flex items-center justify-center h-full w-full bg-muted/30">
    <Card class="max-w-md mx-4">
      <CardHeader class="text-center">
        <div class="flex justify-center mb-4">
          <div
            class="p-3 rounded-full"
            style="background-color: rgba(66, 100, 251, 0.1)"
          >
            <BrandIcon :icon="siMapbox" :size="32" class="mapbox-icon" />
          </div>
        </div>
        <CardTitle class="text-xl">Mapbox Integration Required</CardTitle>
        <CardDescription class="text-center">
          To use Mapbox maps, you need to configure your Mapbox access token in
          the integrations settings.
        </CardDescription>
      </CardHeader>
      <CardContent class="text-center space-y-4">
        <p class="text-sm text-muted-foreground">
          Mapbox provides high-quality interactive maps with advanced features
          like 3D terrain, custom styling, and enhanced performance.
        </p>
        <Button @click="navigateToIntegrations" class="w-full">
          <Settings class="h-4 w-4 mr-2" />
          Configure Mapbox Integration
        </Button>
      </CardContent>
    </Card>
  </div>
</template>

<style scoped>
.mapbox-icon {
  fill: #4264fb !important;
}
</style>
