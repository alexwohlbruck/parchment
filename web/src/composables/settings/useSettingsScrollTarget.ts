import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import {
  useRoute,
  useRouter,
  type RouteLocationNormalizedLoaded,
  type Router,
} from 'vue-router'

// Tracks "what settings section is in view" so the sidebar can highlight
// the matching sub-nav item, plus a navigateToSection helper for hash-
// driven jumps from search results.
//
// Every DOM query is scoped to a root element (the Settings.vue
// component's own root) because Account/Behavior/etc. render TWICE under
// /settings/* — once inside the dialog (visible) and once inside Map's
// LeftSheet (off-screen via CSS transform). A bare document.querySelector
// would return the off-screen copy first and silently break scroll +
// highlight.
//
// Lifecycle ownership is explicit: callers that pass a `root` ref own the
// observers; callers without a `root` are read-only consumers.

const TRIGGER_OFFSET_PX = 24
const FLASH_DURATION_MS = 1200
const SCROLL_POLL_MAX_FRAMES = 40
const BOTTOM_SNAP_THRESHOLD_PX = 4

const activeSectionId = ref<string | null>(null)
let rootEl: HTMLElement | null = null
let scrollContainer: HTMLElement | null = null
let scrollListener: (() => void) | null = null
let teardownFns: Array<() => void> = []

// --- DOM helpers -----------------------------------------------------------

function findScrollContainer(el: HTMLElement): HTMLElement | null {
  let parent: HTMLElement | null = el.parentElement
  while (parent && parent !== document.body) {
    const overflowY = getComputedStyle(parent).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll') return parent
    parent = parent.parentElement
  }
  return null
}

function getSections(): HTMLElement[] {
  if (!rootEl) return []
  return Array.from(
    rootEl.querySelectorAll<HTMLElement>(
      '[data-settings-section][data-section-id]:not([data-section-id=""])',
    ),
  )
}

function findSection(id: string): HTMLElement | null {
  if (!rootEl) return null
  // Use attribute selector instead of #id so we don't fall back to the
  // duplicate copy of this section that lives outside our root.
  return rootEl.querySelector<HTMLElement>(
    `[data-settings-section][data-section-id="${CSS.escape(id)}"]`,
  )
}

// --- Active-section tracking ----------------------------------------------

function recomputeActiveSection() {
  if (!scrollContainer) return
  const containerTop = scrollContainer.getBoundingClientRect().top
  const triggerY = containerTop + TRIGGER_OFFSET_PX

  const sections = getSections()
  let bestId: string | null = null
  let bestTop = -Infinity
  for (const el of sections) {
    const id = el.dataset.sectionId
    if (!id) continue
    const top = el.getBoundingClientRect().top
    // Lowest section whose top has crossed the trigger line wins.
    if (top <= triggerY && top > bestTop) {
      bestTop = top
      bestId = id
    }
  }

  // Bottom-snap safety net: at the very bottom of scroll, force-pick the
  // last section. The dynamic bottom-padding usually makes this redundant
  // but it keeps the highlight honest if padding can't fully apply.
  const distFromBottom =
    scrollContainer.scrollHeight -
    scrollContainer.scrollTop -
    scrollContainer.clientHeight
  if (distFromBottom <= BOTTOM_SNAP_THRESHOLD_PX && sections.length > 0) {
    bestId = sections[sections.length - 1].dataset.sectionId ?? bestId
  }

  // Above the first section: keep the first one selected so we always
  // have a valid highlight.
  if (!bestId) {
    bestId = sections[0]?.dataset.sectionId ?? null
  }

  if (bestId && bestId !== activeSectionId.value) {
    activeSectionId.value = bestId
  }
}

// Pad the bottom of the scroll content so the last section can scroll
// far enough up to reach the top of the container — otherwise short
// sections (or pages with little content below them) can never win the
// active highlight, since they hit max-scroll before crossing the
// trigger line.
function applyBottomPad() {
  if (!scrollContainer || !rootEl) return
  const sections = getSections()
  const last = sections[sections.length - 1]
  if (!last) return
  const wrapper = rootEl.querySelector<HTMLElement>(
    '[data-settings-scroll-content]',
  )
  if (!wrapper) return
  // Reset before measuring — prior padding inflates scrollHeight and skews
  // the lastSection.offsetHeight computation.
  wrapper.style.paddingBottom = ''
  // Math: at max-scroll, lastSection.top should be 0 (flush with the
  // container's top edge). max-scroll = scrollHeight - clientHeight, and
  // scrollHeight = contentBeforeLast + lastHeight + paddingBottom, so
  // paddingBottom = clientHeight - lastHeight.
  const target = Math.max(
    0,
    scrollContainer.clientHeight - last.offsetHeight,
  )
  wrapper.style.paddingBottom = target > 0 ? `${target}px` : ''
}

function refresh() {
  ensureScrollContainerAttached()
  applyBottomPad()
  recomputeActiveSection()
}

function ensureScrollContainerAttached() {
  // Drop a stale container reference if the previous instance has been
  // unmounted (route change re-creating SettingsPage).
  if (scrollContainer && !document.body.contains(scrollContainer)) {
    detachScrollListener()
  }
  if (scrollContainer) return
  const sample = getSections()[0]
  if (!sample) return
  const container = findScrollContainer(sample)
  if (!container) return
  scrollContainer = container
  scrollListener = () => recomputeActiveSection()
  scrollContainer.addEventListener('scroll', scrollListener, { passive: true })
  // Track resize so bottom padding stays correct when the dialog/window
  // is resized.
  const ro = new ResizeObserver(() => {
    applyBottomPad()
    recomputeActiveSection()
  })
  ro.observe(scrollContainer)
  teardownFns.push(() => ro.disconnect())
}

function detachScrollListener() {
  if (scrollContainer && scrollListener) {
    scrollContainer.removeEventListener('scroll', scrollListener)
  }
  scrollContainer = null
  scrollListener = null
}

// --- Scroll-on-arrival -----------------------------------------------------

function flashAndScroll(el: HTMLElement) {
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  el.classList.remove('is-flashing')
  // Force reflow so re-adding the class restarts the transition.
  void el.offsetWidth
  el.classList.add('is-flashing')
  setTimeout(() => el.classList.remove('is-flashing'), FLASH_DURATION_MS)
}

// Section may not be in the DOM yet (e.g. just navigated to a new tab);
// poll a few frames before giving up.
function waitForSectionAndScroll(sectionId: string) {
  let attempts = 0
  const tick = () => {
    const el = findSection(sectionId)
    if (el) {
      flashAndScroll(el)
      return
    }
    if (++attempts < SCROLL_POLL_MAX_FRAMES) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

// --- Navigation -----------------------------------------------------------

function navigateToSection(
  router: Router,
  route: RouteLocationNormalizedLoaded,
  to: string,
  sectionId: string,
) {
  const samePage = route.path === to
  const targetHash = `#${sectionId}`
  if (samePage && route.hash === targetHash) {
    // Same destination — router won't re-fire scrollBehavior. Drive the
    // scroll manually so the click still does something useful.
    const el = findSection(sectionId)
    if (el) flashAndScroll(el)
    return
  }
  if (samePage) {
    router.replace({ path: to, hash: targetHash })
  } else {
    router.push({ path: to, hash: targetHash })
  }
  // Belt-and-suspenders: kick off the scroll directly. Vue Router's
  // scrollBehavior would also fire, but its document.querySelector can
  // hit the off-screen LeftSheet copy of the section.
  waitForSectionAndScroll(sectionId)
}

// --- Lifecycle ------------------------------------------------------------

function initializeOwnership(
  root: Ref<HTMLElement | null>,
  route: RouteLocationNormalizedLoaded,
) {
  rootEl = root.value

  // Watch the ref so that if the owner re-mounts and rebinds it, we
  // catch the new element.
  teardownFns.push(
    watch(root, newEl => {
      rootEl = newEl
      refresh()
    }),
  )

  // Re-scan after each route change (sections render anew per tab). On
  // top-level page switch (no hash), reset scroll to top so the new page
  // doesn't inherit the previous one's scroll position. With a hash, the
  // hash watcher handles the scroll.
  teardownFns.push(
    watch(
      () => route.path,
      (_newPath, oldPath) =>
        requestAnimationFrame(() => {
          refresh()
          if (oldPath && !route.hash && scrollContainer) {
            scrollContainer.scrollTo({ top: 0, behavior: 'instant' })
          }
        }),
      { immediate: true },
    ),
  )

  // Sub-components like Sessions/Passkeys mount their sections lazily;
  // a MutationObserver picks those up without each one registering
  // itself. Scoped to rootEl rather than document.body to keep the
  // observer cost down.
  if (rootEl) {
    const mo = new MutationObserver(refresh)
    mo.observe(rootEl, { childList: true, subtree: true })
    teardownFns.push(() => mo.disconnect())
  }

  // Hash-driven navigation: deep links on first load, back/forward
  // between settings sub-sections, and same-tree URL-hash bumps.
  teardownFns.push(
    watch(
      () => route.hash,
      newHash => {
        if (!newHash) return
        waitForSectionAndScroll(newHash.replace(/^#/, ''))
      },
      { immediate: true },
    ),
  )
}

function teardownOwnership() {
  for (const fn of teardownFns) fn()
  teardownFns = []
  detachScrollListener()
  rootEl = null
  activeSectionId.value = null
}

// --- Public API ------------------------------------------------------------

export function useSettingsScrollTarget(root?: Ref<HTMLElement | null>) {
  const route = useRoute()
  const router = useRouter()

  if (root) {
    onMounted(() => initializeOwnership(root, route))
    onBeforeUnmount(teardownOwnership)
  }

  return {
    activeSectionId,
    navigateToSection: (to: string, sectionId: string) =>
      navigateToSection(router, route, to, sectionId),
  }
}
