import { ref, inject, watch, onUnmounted, type Ref } from 'vue'

/**
 * Marks the bottom of a view's "peek" region so the host BottomSheet can size
 * its peek (first) snap point to fit that content — the Apple-Maps effect where
 * the collapsed sheet rests exactly around the header + primary actions.
 *
 * Attach the returned ref to the LAST element that should be visible at peek;
 * the sheet measures from its own top down to that element's bottom, so the
 * chrome bar, padding, and everything above are included automatically:
 *
 * ```vue
 * <script setup>
 * const { peekRef } = useSheetPeek()
 * </script>
 * <template>
 *   <PlaceHeader />
 *   <PlaceActions />
 *   <div ref="peekRef"><PlaceChips /></div>  <!-- peek ends here -->
 *   <PlaceGallery />                          <!-- revealed when expanded -->
 * </template>
 * ```
 *
 * No-op when there is no host sheet (desktop LeftSheet, or any BottomSheet that
 * hasn't opted into `dynamic-peek`) — the inject simply resolves to null.
 */
export function useSheetPeek(): { peekRef: Ref<HTMLElement | null> } {
  const register = inject<((el: HTMLElement | null) => void) | null>(
    'sheetPeekRegister',
    null,
  )
  const peekRef = ref<HTMLElement | null>(null)

  if (register) {
    // Register on mount and whenever the element swaps (v-if regions). The
    // immediate run covers the case where the ref is already populated.
    watch(peekRef, el => register(el), { immediate: true, flush: 'post' })
    onUnmounted(() => register(null))
  }

  return { peekRef }
}
