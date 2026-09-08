<script setup lang="ts">
import { computed, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import { WifiOffIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { useConnectivity } from '@/composables/useConnectivity'

/**
 * "There's nothing here" — one shape for every list, panel and search result
 * in the app.
 *
 * The library had its own version, but it interpolated `library.entities.*`
 * i18n keys and rendered a fixed Add button, so nothing outside the library
 * could use it. Everywhere else hand-rolled, most memorably a 30-line inline
 * SVG magnifying glass in the place list.
 *
 * Actions go in the default slot rather than being props, since they vary from
 * nothing at all to a full button row.
 *
 * `offline` switches the component to its offline mode: the caller's copy is
 * replaced with "you're offline" messaging, the action slot is hidden (its
 * actions usually need the network), and a retry button nudges a
 * connectivity check and emits `retry` so the screen can refetch. Callers
 * pass `offline` when they have no data *because the fetch couldn't run* —
 * an empty list the server actually returned should render the normal state.
 */
const props = withDefaults(
  defineProps<{
    icon?: Component
    title: string
    description?: string
    /**
     * `panel` centres in the available height, for a view that is otherwise
     * empty. `inline` sits compactly inside a list that has other content
     * above it. `card` is `inline` in a dashed frame, for a section of a page
     * whose other sections are full — it reads as a place something goes
     * rather than as the page having nothing to say.
     */
    variant?: 'panel' | 'inline' | 'card'
    offline?: boolean
    /**
     * Keep the action slot in offline mode, in place of the retry button.
     * Actions are hidden by default because most need the network, but
     * anything that works offline — creating a canvas or route, which the
     * sync queue holds until there's a connection — is a better thing to
     * offer than asking the user to retry something that retries itself.
     */
    offlineActions?: boolean
  }>(),
  { variant: 'panel', offline: false, offlineActions: false },
)

const emit = defineEmits<{ retry: [] }>()

const { t } = useI18n()
const { checkNow } = useConnectivity()

/** Everything but `panel` is the small treatment; `card` just adds the frame. */
const compact = computed(() => props.variant !== 'panel')

const containerClass = computed(() => {
  if (props.variant === 'panel') return 'py-12 gap-3'
  if (props.variant === 'card')
    return 'rounded-lg border border-dashed px-4 py-6 gap-2'
  return 'py-6 gap-2'
})

const displayIcon = computed(() => (props.offline ? WifiOffIcon : props.icon))
const displayTitle = computed(() =>
  props.offline ? t('offline.emptyState.title') : props.title,
)
const displayDescription = computed(() => {
  if (!props.offline) return props.description
  // Don't say "go back online" next to a button they can press right now.
  return props.offlineActions
    ? t('offline.emptyState.descriptionCreatable')
    : t('offline.emptyState.description')
})

function retry() {
  checkNow()
  emit('retry')
}
</script>

<template>
  <div
    class="flex flex-col items-center justify-center text-center"
    :class="containerClass"
  >
    <div
      v-if="displayIcon"
      class="flex items-center justify-center rounded-full bg-muted/50"
      :class="compact ? 'size-9' : 'size-12'"
    >
      <component
        :is="displayIcon"
        class="text-muted-foreground"
        :class="compact ? 'size-4' : 'size-6'"
      />
    </div>

    <div class="space-y-0.5">
      <p
        class="font-semibold text-foreground"
        :class="compact ? 'text-sm' : 'text-base'"
      >
        {{ displayTitle }}
      </p>
      <p v-if="displayDescription" class="text-sm text-muted-foreground">
        {{ displayDescription }}
      </p>
    </div>

    <!-- One action, never two. Connectivity recovers on its own and the
         view refetches with it, so "Try again" is only worth offering when
         there's nothing else to do here. -->
    <template v-if="offline">
      <slot v-if="offlineActions" />
      <Button v-else size="sm" variant="outline" @click="retry">
        {{ t('offline.retry') }}
      </Button>
    </template>
    <slot v-else />
  </div>
</template>
