<script setup lang="ts">
import {
  computed,
  ref,
  watch,
  onMounted,
  markRaw,
  h,
  defineComponent,
  type Component,
} from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth.store'
import { useCommandStore, CommandName } from '@/stores/command.store'
import { useThemeStore } from '@/stores/theme.store'
import { useAuthService } from '@/services/auth.service'
import { APP_VERSION } from '@/lib/constants'
import { appEventBus } from '@/lib/eventBus'
import { fetchLatestRelease } from '@/composables/useGitHubReleases'
import type { GitHubReleaseSummary } from '@/composables/useGitHubReleases'

import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import ResponsiveDropdown, {
  type MenuItemDefinition,
} from '@/components/responsive/ResponsiveDropdown.vue'
import {
  SettingsIcon,
  SunIcon,
  MoonIcon,
  LanguagesIcon,
  MessageSquareQuoteIcon,
  LogOutIcon,
  ChevronUpIcon,
  CheckIcon,
  InfoIcon,
  KeyboardIcon,
  FileTextIcon,
  CodeIcon,
  ExternalLinkIcon,
  CalendarIcon,
} from 'lucide-vue-next'
import Kbd from '@/components/ui/kbd/Kbd.vue'
import AboutDialog from '@/components/dialogs/AboutDialog.vue'

const props = defineProps<{
  mini?: boolean
}>()

const { t, locale } = useI18n()
const authStore = useAuthStore()
const { me } = storeToRefs(authStore)
const commandStore = useCommandStore()
const themeStore = useThemeStore()
const { isDark } = storeToRefs(themeStore)
const { toggleDark } = themeStore
const authService = useAuthService()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
}>()

const dropdownOpen = ref(false)

watch(dropdownOpen, val => {
  emit('update:open', val)
})
const aboutDialogOpen = ref(false)
const latestRelease = ref<GitHubReleaseSummary | null>(null)

const RELEASES_HREF = 'https://github.com/alexwohlbruck/parchment/releases'
const DOCS_HREF = 'https://docs.parchment.app'

onMounted(() => {
  fetchLatestRelease().then(release => {
    latestRelease.value = release
  })
})
const API_DOCS_HREF = 'https://docs.parchment.app/docs/api'

// Language options from command store
const languageOptions = computed(() =>
  commandStore.getCommandArgumentOptions(
    CommandName.UPDATE_LANGUAGE,
    'language',
  ),
)

// Create a reactive Switch wrapper component
const DarkModeSwitch = markRaw(
  defineComponent({
    name: 'DarkModeSwitch',
    setup() {
      return () =>
        h(Switch, {
          modelValue: isDark.value,
          'onUpdate:modelValue': () => toggleDark(),
          class: 'scale-75',
        })
    },
  }),
) as Component

// Build menu items for ResponsiveDropdown
const menuItems = computed((): MenuItemDefinition[] => {
  const items: MenuItemDefinition[] = [
    {
      type: 'item',
      id: 'dark-mode',
      label: t('settings.appearance.appTheme.theme.title'),
      icon: isDark.value ? MoonIcon : SunIcon,
      trailing: DarkModeSwitch,
      keepOpen: true,
      onSelect: () => {
        toggleDark()
      },
    },
    {
      type: 'submenu',
      id: 'language',
      label: t('palette.commands.updateLanguage.name'),
      icon: LanguagesIcon,
      items:
        languageOptions.value?.map(lang => ({
          type: 'item' as const,
          id: `lang-${lang.value}`,
          label: lang.name as string,
          trailing: locale.value === lang.value ? CheckIcon : undefined,
          trailingProps: { class: 'size-4 text-primary' },
          onSelect: () => {
            locale.value = lang.value.toString()
          },
        })) ?? [],
    },
    {
      type: 'item',
      id: 'shortcuts',
      label: t('profileMenu.shortcuts'),
      icon: KeyboardIcon,
      trailing: markRaw(Kbd),
      trailingProps: { hotkey: ['h'], size: 'xs' },
      onSelect: () => {
        appEventBus.emit('hotkeys:open')
      },
    },
    {
      type: 'item',
      id: 'docs',
      label: t('profileMenu.docs'),
      icon: FileTextIcon,
      href: DOCS_HREF,
      trailing: ExternalLinkIcon,
      trailingProps: { class: 'size-4 text-muted-foreground shrink-0' },
    },
    {
      type: 'item',
      id: 'api-docs',
      label: t('profileMenu.apiDocs'),
      icon: CodeIcon,
      href: API_DOCS_HREF,
      trailing: ExternalLinkIcon,
      trailingProps: { class: 'size-4 text-muted-foreground shrink-0' },
    },
    {
      type: 'item',
      id: 'feedback',
      label: t('feedback.title'),
      icon: MessageSquareQuoteIcon,
      href: 'https://github.com/alexwohlbruck/parchment/issues',
    },
    {
      type: 'item',
      id: 'settings',
      label: t('settings.title'),
      icon: SettingsIcon,
      to: '/settings',
    },
    {
      type: 'separator',
    },
    {
      type: 'item',
      id: 'sign-out',
      label: t('palette.commands.signOut.name'),
      icon: LogOutIcon,
      variant: 'destructive',
      onSelect: () => {
        authService.signOut()
      },
    },
    {
      type: 'separator',
    },
    {
      type: 'label',
      id: 'whats-new-label',
      label: t('profileMenu.whatsNew'),
    },
    {
      type: 'item',
      id: 'changelog-latest',
      label: latestRelease.value?.title ?? t('profileMenu.whatsNew'),
      icon: CalendarIcon,
      href: latestRelease.value?.url ?? RELEASES_HREF,
      trailing: ExternalLinkIcon,
      trailingProps: { class: 'size-4 text-muted-foreground shrink-0' },
    },
  ]
  return items
})
</script>

<template>
  <ResponsiveDropdown
    v-if="me"
    v-model:open="dropdownOpen"
    :items="menuItems"
    :side="mini ? 'right' : 'top'"
    :align="mini ? 'end' : 'start'"
    :side-offset="8"
    content-class="w-56"
  >
    <template #trigger="{ open }">
      <Button
        variant="ghost"
        :class="
          cn(
            'w-full h-auto px-1 py-2 rounded-lg flex flex-row justify-center gap-2 hover:bg-foreground/5',
          )
        "
        @click.stop="open"
      >
        <Avatar size="xs">
          <AvatarImage
            v-if="me.picture"
            :src="me.picture"
            :alt="me.firstName"
          />
          <AvatarFallback v-else>
            {{ me.firstName?.charAt(0) }}{{ me.lastName?.charAt(0) }}
          </AvatarFallback>
        </Avatar>

        <div class="flex flex-col text-nowrap flex-1 text-left" v-if="!mini">
          <span class="text-sm font-semibold leading-4">
            {{ me.firstName }} {{ me.lastName }}
          </span>
          <span class="text-xs text-gray-500 leading-4">{{ me.email }}</span>
        </div>

        <ChevronUpIcon
          v-if="!mini"
          class="size-4 text-muted-foreground self-center"
        />
      </Button>
    </template>

    <!-- Custom header with avatar -->
    <template #header>
      <div class="px-2 py-1.5">
        <div class="flex items-center gap-2">
          <Avatar size="sm">
            <AvatarImage
              v-if="me.picture"
              :src="me.picture"
              :alt="me.firstName"
            />
            <AvatarFallback v-else>
              {{ me.firstName?.charAt(0) }}{{ me.lastName?.charAt(0) }}
            </AvatarFallback>
          </Avatar>
          <div class="flex flex-col">
            <span class="text-sm font-semibold">
              {{ me.firstName }} {{ me.lastName }}
            </span>
            <span class="text-xs text-muted-foreground">{{ me.email }}</span>
          </div>
        </div>
      </div>
      <div class="h-px bg-border my-1" />
      <!-- TODO: Replace with separator component -->
    </template>

    <!-- Version footer -->
    <template #footer>
      <div class="h-px bg-border my-1" />
      <div class="flex items-center justify-between gap-2 px-2 pb-2 py-1">
        <span class="ml-1 text-xs text-muted-foreground">
          v{{ APP_VERSION }}
        </span>
        <Button
          variant="ghost"
          size="icon"
          class="size-7 shrink-0 text-muted-foreground hover:text-foreground"
          :aria-label="t('about.title', 'About')"
          @click="aboutDialogOpen = true"
        >
          <InfoIcon class="size-4" />
        </Button>
      </div>
    </template>
  </ResponsiveDropdown>

  <AboutDialog v-model:open="aboutDialogOpen" />
</template>
