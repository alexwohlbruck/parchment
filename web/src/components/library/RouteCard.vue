<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { Card, CardContent } from '@/components/ui/card'
import { ItemIcon } from '@/components/ui/item-icon'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  MoreHorizontalIcon,
  PencilIcon,
  Share2Icon,
  Trash2Icon,
  LockIcon,
} from 'lucide-vue-next'
import { AppRoute } from '@/router'
import { useUnits } from '@/composables/useUnits'
import { useRoutesService } from '@/services/library/routes.service'
import { type ThemeColor } from '@/lib/utils'
import type { Route, RouteMode } from '@/types/routes.types'

const props = defineProps<{ route: Route }>()

const router = useRouter()
const { formatDistance } = useUnits()
const routesService = useRoutesService()

// Mode → lucide glyph + theme color, matching the travel-mode palette.
const MODE_ICON: Record<RouteMode, string> = {
  walking: 'Footprints',
  cycling: 'Bike',
  driving: 'CarFront',
}
const MODE_COLOR: Record<RouteMode, ThemeColor> = {
  walking: 'cobalt',
  cycling: 'forest',
  driving: 'violet',
}

const displayName = computed(() =>
  routesService.getRouteDisplayName(props.route),
)
const isPrivate = computed(() => props.route.scheme === 'user-e2ee')

const meta = computed(() => {
  const parts: string[] = [
    props.route.mode.charAt(0).toUpperCase() + props.route.mode.slice(1),
  ]
  const d = props.route.distance ?? props.route.body?.stats?.distance
  if (typeof d === 'number') parts.push(formatDistance(d))
  if (props.route.description) parts.push(props.route.description)
  return parts.join(' · ')
})

function open() {
  router.push({ name: AppRoute.ROUTE_DETAIL, params: { id: props.route.id } })
}
function edit() {
  router.push({
    name: AppRoute.ROUTE_BUILDER_EDIT,
    params: { id: props.route.id },
  })
}
async function share() {
  const url = await routesService.createShareLink(props.route.id)
  if (url) await navigator.clipboard.writeText(url).catch(() => {})
}
async function remove() {
  await routesService.deleteRoute(props.route.id)
}
</script>

<template>
  <Card
    class="overflow-hidden hover:bg-secondary/40 transition-colors cursor-pointer"
    @click="open"
  >
    <CardContent class="p-2 flex items-center gap-3">
      <ItemIcon
        :icon="MODE_ICON[route.mode]"
        :color="MODE_COLOR[route.mode]"
        size="md"
      />

      <div class="grow min-w-0">
        <div class="flex items-center justify-between">
          <div class="flex flex-col justify-center min-w-0">
            <div class="flex items-center gap-1.5">
              <h3 class="font-sans font-semibold text-sm truncate">
                {{ displayName }}
              </h3>
              <LockIcon
                v-if="isPrivate"
                class="size-3 text-muted-foreground shrink-0"
              />
            </div>
            <div class="text-xs text-muted-foreground truncate">
              {{ meta }}
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger as-child @click.stop>
              <Button variant="ghost" size="icon" class="shrink-0">
                <MoreHorizontalIcon class="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" @click.stop>
              <DropdownMenuItem @click="edit">
                <PencilIcon class="size-4" /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem v-if="!isPrivate" @click="share">
                <Share2Icon class="size-4" /> Copy share link
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem class="text-destructive" @click="remove">
                <Trash2Icon class="size-4" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </CardContent>
  </Card>
</template>
