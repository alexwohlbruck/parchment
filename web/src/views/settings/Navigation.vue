<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useResponsive } from '@/lib/utils'
import { H3, Caption } from '@/components/ui/typography'
import Button from '@/components/ui/button/Button.vue'
import { Input } from '@/components/ui/input'
import { useI18n } from 'vue-i18n'

import { SearchIcon, XIcon, CornerDownLeftIcon } from 'lucide-vue-next'
import { useSettingsIndex } from '@/composables/useSettingsIndex'
import { useSettingsScrollTarget } from '@/composables/useSettingsScrollTarget'
import { getThemeColorGhostClasses } from '@/lib/utils'

const route = useRoute()
const { isMobileScreen } = useResponsive()
const { t } = useI18n()
const { allowedPages, sectionsByPage, search } = useSettingsIndex()
const { activeSectionId, navigateToSection } = useSettingsScrollTarget()

const SUBNAV_EXPAND_DURATION_MS = 180

// --- Search state -----------------------------------------------------------
const searchQuery = ref('')
const isSearching = computed(() => searchQuery.value.trim().length > 0)
const searchResults = computed(() => search(searchQuery.value))
const highlightedIndex = ref(0)
// Input is a component wrapper, so the ref resolves to the component
// instance — `$el` gives us the underlying <input> for focus().
const searchInputRef = ref<{ $el: HTMLInputElement } | null>(null)

watch(searchResults, () => {
  highlightedIndex.value = 0
})

function clearSearch() {
  searchQuery.value = ''
  highlightedIndex.value = 0
}

function onSearchKeydown(event: KeyboardEvent) {
  if (!isSearching.value) return
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    highlightedIndex.value =
      (highlightedIndex.value + 1) % Math.max(1, searchResults.value.length)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    const len = Math.max(1, searchResults.value.length)
    highlightedIndex.value = (highlightedIndex.value - 1 + len) % len
  } else if (event.key === 'Enter') {
    event.preventDefault()
    const result = searchResults.value[highlightedIndex.value]
    if (result) selectResult(result.to, result.sectionId)
  } else if (event.key === 'Escape') {
    if (searchQuery.value) {
      event.preventDefault()
      clearSearch()
    }
  }
}

function selectResult(to: string, sectionId: string) {
  navigateToSection(to, sectionId)
  clearSearch()
}

// --- Sub-nav active section -------------------------------------------------
function isActivePage(to: string) {
  return route.path === to
}

function currentSubSections(pageId: string) {
  return sectionsByPage.value.get(pageId) ?? []
}

// Mobile rows show a quiet subtitle of the first few section names per
// page, e.g. Account → "User · Federation Identity · Encryption keys" —
// gives readers an at-a-glance preview of what lives inside.
//
// Suppressed when the only section name is the page title itself
// (Integrations → "Integrations"), which would just be noise.
const SUBTITLE_SECTION_LIMIT = 3
function subtitleFor(pageId: string): string {
  const sections = sectionsByPage.value.get(pageId) ?? []
  if (sections.length === 0) return ''
  const pageTitle = t(`settings.${pageId}.title`)
  if (
    sections.length === 1 &&
    sections[0].title.trim() === pageTitle.trim()
  )
    return ''
  return sections
    .slice(0, SUBTITLE_SECTION_LIMIT)
    .map(s => s.title)
    .join(' · ')
}

// --- Cmd+K / Ctrl+K shortcut to focus the settings search -------------------
function onGlobalKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  const isModifier = event.metaKey || event.ctrlKey
  if (!isModifier || event.key.toLowerCase() !== 'k') return
  // Only intercept when we're on a settings page so we don't steal global
  // shortcuts elsewhere in the app.
  if (!route.path.startsWith('/settings')) return
  // Don't fight an input that explicitly handles ⌘K.
  if (target?.closest('[data-cmdk-input-wrapper]')) return
  event.preventDefault()
  const inputEl = searchInputRef.value?.$el
  inputEl?.focus()
  inputEl?.select()
}

onMounted(() => {
  window.addEventListener('keydown', onGlobalKeydown)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
})
</script>

<template>
  <div class="flex flex-col w-full md:w-56 gap-3 pt-6 px-4 md:pr-0 min-h-0">
    <H3 class="ml-2">{{ t('settings.title') }}</H3>

    <!-- Search -->
    <div class="relative px-1">
      <SearchIcon
        class="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none"
      />
      <Input
        ref="searchInputRef"
        v-model="searchQuery"
        type="search"
        :placeholder="t('settings.search.placeholder')"
        class="pl-9 pr-8 h-9"
        :aria-label="t('settings.search.placeholder')"
        @keydown="onSearchKeydown"
      />
      <Button
        v-if="isSearching"
        variant="ghost"
        size="icon"
        class="absolute right-1.5 top-1/2 -translate-y-1/2 size-7"
        :aria-label="t('settings.search.clear')"
        @click="clearSearch"
      >
        <XIcon class="size-4" />
      </Button>
    </div>

    <!-- Search results -->
    <div
      v-if="isSearching"
      class="overflow-y-auto flex-1 flex flex-col gap-0.5 px-1"
      role="listbox"
    >
      <Caption v-if="searchResults.length === 0" class="px-3 py-2">
        {{ t('settings.search.noResults') }}
      </Caption>
      <button
        v-for="(result, i) in searchResults"
        :key="`${result.pageId}-${result.sectionId}-${result.title}-${i}`"
        type="button"
        role="option"
        :aria-selected="i === highlightedIndex"
        class="relative text-left flex flex-col gap-0.5 rounded-md px-3 py-2 pr-8 transition-colors hover:bg-primary/5 hover:text-primary"
        :class="
          i === highlightedIndex
            ? 'bg-primary/5 text-primary'
            : 'text-foreground'
        "
        @click="selectResult(result.to, result.sectionId)"
        @mouseenter="highlightedIndex = i"
      >
        <span class="text-sm font-medium leading-tight">
          {{ result.title }}
        </span>
        <span class="text-xs text-muted-foreground leading-tight">
          {{ result.pageTitle }}
          <template v-if="result.level === 'item'">
            · {{ result.sectionTitle }}
          </template>
        </span>
        <CornerDownLeftIcon
          v-if="i === highlightedIndex"
          class="absolute right-3 top-1/2 -translate-y-1/2 size-3.5 opacity-60"
        />
      </button>
    </div>

    <!-- Page list (idle) -->
    <template v-else>
      <!-- Mobile: chrome-free list with a tinted icon tile per page.
           The ghost-tinted icon style mirrors place-category icons
           (light/dark-aware bg + foreground tints) so settings looks
           like it belongs to the same product. -->
      <nav
        v-if="isMobileScreen"
        class="overflow-y-auto overflow-x-hidden flex flex-col gap-1 min-w-0"
      >
        <router-link
          v-for="page in allowedPages"
          :key="page.pageId"
          :to="page.to"
          :aria-disabled="page.disabled || undefined"
          :tabindex="page.disabled ? -1 : 0"
          class="flex items-center gap-3 px-2 py-2.5 -mx-1 rounded-md transition-colors active:bg-foreground/5 min-w-0"
          :class="page.disabled && 'opacity-30 pointer-events-none'"
        >
          <span
            class="flex items-center justify-center size-10 rounded-md shrink-0"
            :class="getThemeColorGhostClasses(page.iconColor)"
          >
            <component :is="page.icon" class="size-5" />
          </span>
          <span class="flex-1 min-w-0 flex flex-col gap-0.5">
            <span
              class="text-[15px] font-semibold tracking-tight leading-tight truncate"
            >
              {{ t(`settings.${page.pageId}.title`) }}
            </span>
            <span
              v-if="subtitleFor(page.pageId)"
              class="text-xs text-muted-foreground leading-tight truncate"
            >
              {{ subtitleFor(page.pageId) }}
            </span>
          </span>
        </router-link>
      </nav>

      <!-- Desktop side nav -->
      <nav v-else class="overflow-y-auto flex flex-col gap-0.5 min-h-0">
        <template v-for="page in allowedPages" :key="page.pageId">
          <Button
            variant="ghost"
            class="flex px-3 justify-start gap-3 hover:bg-primary/5 hover:text-primary"
            as-child
            :to="page.to"
            :class="
              isActivePage(page.to)
                ? 'bg-primary/5 text-primary font-medium'
                : ''
            "
            :disabled="page.disabled"
          >
            <router-link :to="page.to">
              <component :is="page.icon" class="size-5 shrink-0" />
              <span class="flex-1 text-left">
                {{ t(`settings.${page.pageId}.title`) }}
              </span>
            </router-link>
          </Button>

          <!-- Sub-sections of the active page -->
          <transition-expand
            axis="y"
            :duration="SUBNAV_EXPAND_DURATION_MS"
            easing="ease-out"
          >
            <div
              v-if="
                isActivePage(page.to) && currentSubSections(page.pageId).length > 0
              "
              class="ml-4 my-0.5 border-l border-border/60 flex flex-col gap-px"
            >
              <router-link
                v-for="section in currentSubSections(page.pageId)"
                :key="section.id"
                :to="{ path: page.to, hash: section.hash }"
                class="text-left text-sm pl-4 pr-2 py-1.5 -ml-px border-l-2 transition-colors leading-tight hover:text-primary"
                :class="
                  activeSectionId === section.id
                    ? 'border-primary text-primary font-medium'
                    : 'border-transparent text-muted-foreground'
                "
                @click.prevent="navigateToSection(page.to, section.id)"
              >
                {{ section.title }}
              </router-link>
            </div>
          </transition-expand>
        </template>
      </nav>
    </template>
  </div>
</template>
