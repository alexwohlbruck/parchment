<script setup lang="ts">
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import { Button } from '@/components/ui/button'
import { H1, H3, Span } from '@/components/ui/typography'
import { ArrowLeftIcon } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

const router = useRouter()
const { t } = useI18n()

const goHome = () => {
  router.push({ name: AppRoute.MAP })
}
</script>

<template>
  <div class="h-full w-full flex gap-4 items-center justify-center h-screen">
    <div class="ship-wrapper">
      <div class="ship">⛵</div>
    </div>
    <div class="flex flex-col gap-4 items-start">
      <div class="flex flex-col gap-1">
        <H1 class="font-bold">{{ t('notFound.title') }}</H1>
        <H3 class="font-semibold">{{ t('notFound.subtitle') }}</H3>
        <Span class="text-muted-foreground mt-0!">
          {{ t('notFound.message') }}
        </Span>
      </div>
      <Button variant="outline" @click="goHome" class="gap-2">
        <ArrowLeftIcon class="h-4 w-4" />
        {{ t('notFound.action') }}
      </Button>
    </div>
  </div>
</template>

<style scoped>
.ship-wrapper {
  animation: bobUpDown 2.3s ease-in-out infinite;
}

.ship {
  font-size: 5rem;
  margin-bottom: 1rem;
  animation: rockSideToSide 3.7s ease-in-out infinite;
  transform-origin: center;
}

.compass {
  font-size: 1.2rem;
}

@keyframes rockSideToSide {
  0%,
  100% {
    transform: rotate(-5deg);
  }
  50% {
    transform: rotate(5deg);
  }
}

@keyframes bobUpDown {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-10px);
  }
}
</style>
