<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useAuthService } from '@/services/auth.service'

import H2 from '@/components/ui/typography/H2.vue'
import { Separator } from '@/components/ui/separator'
import Button from '@/components/ui/button/Button.vue'

import { Icon } from '@/types/app.types'
import {
  UserRoundIcon,
  CogIcon,
  PaintbrushIcon,
  DatabaseIcon,
  ActivityIcon,
  Contact2Icon,
} from 'lucide-vue-next'
import { PermissionRule } from '@/types/auth.types'
import { PermissionId as Permission } from '@/types/auth.types'
import { computed } from 'vue'

const router = useRouter()
const authService = useAuthService()

const pages: {
  id: string
  to: string
  icon: Icon
  disabled?: boolean
  permissions?: PermissionRule
}[] = [
  {
    id: 'account',
    to: '/settings/account',
    icon: UserRoundIcon,
    disabled: true,
  },
  {
    id: 'behavior',
    to: '/settings/behavior',
    icon: CogIcon,
  },
  {
    id: 'appearance',
    to: '/settings/appearance',
    icon: PaintbrushIcon,
  },
  {
    id: 'mapData',
    to: '/settings/map-data',
    icon: DatabaseIcon,
  },
  {
    id: 'users',
    to: '/settings/users',
    icon: Contact2Icon,
    disabled: true,
    permissions: {
      any: [
        Permission.USERS_READ,
        Permission.ROLES_READ,
        Permission.PERMISSIONS_READ,
      ],
    }, // TODO: Global permissions list
  },
  {
    id: 'system',
    to: '/settings/system',
    icon: ActivityIcon,
    disabled: true,
    // permissions: 'system:read', // TODO: Global permissions list
  },
]

const allowedPages = computed(() => {
  return pages.filter(
    page => !page.permissions || authService.hasPermission(page.permissions),
  )
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <div>
      <H2>{{ $t('settings.title') }}</H2>
      <P>{{ $t('settings.description') }}</P>
    </div>

    <Separator />

    <div class="flex gap-4">
      <div class="w-40">
        <Button
          v-for="(page, i) in allowedPages"
          :key="i"
          variant="ghost"
          class="w-full flex px-3 justify-center gap-3"
          as-child
          :to="page.to"
          :class="
            router.currentRoute.value.path === page.to
              ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50'
              : ''
          "
          :disabled="page.disabled"
        >
          <router-link :to="page.to">
            <component :is="page.icon" class="size-5" />

            <transition-expand axis="x" :duration="50" easing="ease-out">
              <div class="flex flex-1 gap-1 text-nowrap">
                <div class="flex-1">
                  {{ $t(`settings.${page.id}.title`) }}
                </div>
              </div>
            </transition-expand>
          </router-link>
        </Button>
      </div>

      <div class="flex-1 flex justify-center overflow-y-auto">
        <router-view class="w-full max-w-[52rem] items-start" />
      </div>
    </div>
  </div>
</template>
