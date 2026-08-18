<script setup lang="ts">
/**
 * One disruption, in the agency's own words.
 *
 * The header is the line they wrote to be read at a glance, so it carries the
 * severity colour and nothing else competes with it. The description is often
 * several paragraphs of operational prose — stop lists, "listen to
 * announcements on board" — so it is clamped to a few lines with an expand
 * rather than pushing everything else off the page.
 *
 * The footnote says when it took effect. That matters more than it looks: an
 * alert posted three weeks ago reads very differently from one posted at
 * 11pm tonight, and agencies leave stale notices up.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { TriangleAlertIcon, ExternalLinkIcon } from 'lucide-vue-next'
import { alertTone, alertStart, alertEnd } from '@/lib/transit-alerts'
import { useExternalLink } from '@/composables/useExternalLink'
import type { ServiceAlert } from '@/types/transit.types'

const props = defineProps<{ alert: ServiceAlert }>()

const { t } = useI18n()
const { openExternalLink } = useExternalLink()

const expanded = ref(false)

const tone = computed(() => alertTone(props.alert))

const headerClass = computed(() => ({
  severe: 'text-red-600 dark:text-red-400',
  warning: 'text-amber-600 dark:text-amber-400',
  info: 'text-foreground',
}[tone.value]))

const iconClass = computed(() => ({
  severe: 'text-red-600 dark:text-red-400',
  warning: 'text-amber-600 dark:text-amber-400',
  info: 'text-muted-foreground',
}[tone.value]))

/** Long prose gets a "show more"; a two-line note doesn't need one. */
const CLAMP_CHARS = 180
const isLong = computed(() => (props.alert.description?.length ?? 0) > CLAMP_CHARS)

function formatWhen(date: Date): string {
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** When it started, or when it lifts — whichever the feed actually committed to. */
const timing = computed(() => {
  const start = alertStart(props.alert)
  const end = alertEnd(props.alert)
  if (start && start.getTime() > Date.now()) {
    return t('place.transit.alerts.startsAt', { date: formatWhen(start) })
  }
  if (start) return t('place.transit.alerts.inEffectSince', { date: formatWhen(start) })
  if (end) return t('place.transit.alerts.until', { date: formatWhen(end) })
  return null
})
</script>

<template>
  <article class="rounded-lg border bg-card/50 px-3 py-2.5">
    <div class="flex items-start gap-2.5">
      <TriangleAlertIcon class="size-4 shrink-0 mt-0.5" :class="iconClass" />

      <div class="min-w-0 flex-1">
        <h3 class="text-sm font-semibold leading-snug" :class="headerClass">
          {{ alert.header }}
        </h3>

        <p
          v-if="alert.description"
          class="mt-1 text-xs leading-relaxed text-muted-foreground whitespace-pre-line"
          :class="!expanded && isLong && 'line-clamp-3'"
        >{{ alert.description }}</p>

        <button
          v-if="isLong"
          type="button"
          class="mt-1 text-xs text-primary hover:underline"
          @click="expanded = !expanded"
        >
          {{ expanded ? t('place.transit.alerts.showLess') : t('place.transit.alerts.showMore') }}
        </button>

        <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span v-if="timing">{{ timing }}</span>
          <button
            v-if="alert.url"
            type="button"
            class="inline-flex items-center gap-1 hover:text-foreground transition-colors"
            @click="openExternalLink(alert.url!, '_blank')"
          >
            <ExternalLinkIcon class="size-3" />
            {{ t('place.transit.alerts.moreInfo') }}
          </button>
        </div>
      </div>
    </div>
  </article>
</template>
