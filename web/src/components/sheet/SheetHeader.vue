<script setup lang="ts">
import {
  inject,
  onMounted,
  onUnmounted,
  ref,
  watchEffect,
  type HTMLAttributes,
} from 'vue'
import { cn } from '@/lib/utils'
import { useSheetPeek } from '@/composables/useSheetPeek'
import { useStuck } from '@/composables/useStuck'

/**
 * Sticky header region of a sheet — see the layout contract in
 * `components/BottomSheet.vue`.
 *
 * Pins to the top of the host sheet's scroll surface while the content below
 * scrolls under it, docking beneath the sheet's chrome (drag handle + nav
 * buttons) via `--sheet-sticky-top`. It also becomes the sheet's peek anchor
 * by default, so the collapsed detent rests exactly around this header.
 *
 * Renders in place — it never portals — so it works the same from a routed
 * view inside the mobile sheet, from a direct child, and inside the desktop
 * LeftSheet (where the sticky top is simply 0 and there is no peek).
 *
 * The default slot receives `stuck` — true once the header has actually
 * pinned — for headers that reveal a border or shadow only while they cover
 * content.
 */
const props = withDefaults(
  defineProps<{
    class?: HTMLAttributes['class']
    /**
     * Size the host sheet's collapsed (peek) detent to this header. Turn off
     * for a secondary sticky bar that shouldn't drive the detent — e.g. a tab
     * row below a header that already anchors the peek.
     */
    peek?: boolean
    /**
     * Opaque backing so scrolled content dissolves behind the header. Turn off
     * to supply your own (a gradient, a blur, a fade tied to scroll state).
     */
    solid?: boolean
  }>(),
  { peek: true, solid: true },
)

const el = ref<HTMLElement | null>(null)
const { stuck } = useStuck(el)
const { peekRef } = useSheetPeek()
watchEffect(() => {
  peekRef.value = props.peek ? el.value : null
})

// Opt the host sheet into its opaque chrome bar: with a header pinned to the
// scroll surface, content has to scroll cleanly *under* the drag handle rather
// than be shoved below it. Claims are counted by the sheet, so overlapping
// headers (a pushed sub-page over the view it came from) don't fight. No-op
// outside a BottomSheet.
const chromeBar = inject<{
  acquire: () => void
  release: () => void
} | null>('sheetChromeBarClaim', null)
onMounted(() => chromeBar?.acquire())
onUnmounted(() => chromeBar?.release())
</script>

<template>
  <div
    ref="el"
    :class="cn('sticky z-20', props.solid && 'bg-background', props.class)"
    :style="{ top: 'var(--sheet-sticky-top, 0px)' }"
  >
    <slot :stuck="stuck" />
  </div>
</template>
