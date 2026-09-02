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
import { useIntegrationsStore } from '@/stores/integrations.store'
import { useCommandStore, CommandName } from '@/stores/command.store'
import { useThemeStore } from '@/stores/theme.store'
import { useAuthService } from '@/services/auth.service'
import { useIntegrationService } from '@/services/integration.service'
import { APP_VERSION } from '@/lib/constants'
import { appEventBus } from '@/lib/eventBus'
import { fetchLatestRelease } from '@/composables/useGitHubReleases'
import type { GitHubReleaseSummary } from '@/composables/useGitHubReleases'

import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
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
  ChevronsUpDownIcon,
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
const integrationsStore = useIntegrationsStore()
const { osmProfile } = storeToRefs(integrationsStore)
const commandStore = useCommandStore()
const themeStore = useThemeStore()
const { isDark } = storeToRefs(themeStore)
const { toggleDark } = themeStore
const authService = useAuthService()
const integrationService = useIntegrationService()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
}>()

const dropdownOpen = ref(false)

watch(dropdownOpen, val => {
  emit('update:open', val)
  if (val && osmProfile.value) {
    integrationService.fetchOsmProfile()
  }
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
const API_DOCS_HREF = 'https://docs.parchment.app/api'

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
        authService.confirmAndSignOut()
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
    content-class="w-64"
  >
    <template #trigger="{ open }">
      <!-- Sized to the sidebar's row rhythm on desktop, and to a comfortable
           touch target on mobile, where this same trigger sits in the sheet.
           The email is one click away in the menu header, so the row stays a
           single line and lines up with the links above it. -->
      <Button
        variant="ghost"
        :class="
          cn(
            'w-full h-11 md:h-10 gap-2.5 rounded-md flex flex-row justify-start',
            'text-foreground hover:bg-foreground/5',
            // The avatar is wider than a row icon, so the padding — not its
            // left edge — is what puts it on the collapsed rail's centre line.
            mini ? 'px-0.5' : 'px-2',
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

        <span
          v-if="!mini"
          class="flex-1 min-w-0 text-left text-sm font-medium truncate"
        >
          {{ me.firstName }} {{ me.lastName }}
        </span>

        <ChevronsUpDownIcon
          v-if="!mini"
          class="size-4 shrink-0 text-muted-foreground"
        />
      </Button>
    </template>

    <!-- Custom header with avatar -->
    <template #header>
      <div class="px-2 py-2">
        <div class="flex items-center gap-2.5 min-w-0">
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
          <div class="flex flex-col min-w-0">
            <span class="text-sm font-semibold leading-tight truncate">
              {{ me.firstName }} {{ me.lastName }}
            </span>
            <span class="text-xs text-muted-foreground leading-tight truncate">{{
              me.email
            }}</span>
            <a
              v-if="
                osmProfile?.osmChangesetCount != null &&
                osmProfile?.osmDisplayName
              "
              :href="`https://www.openstreetmap.org/user/${encodeURIComponent(osmProfile.osmDisplayName)}`"
              target="_blank"
              rel="noopener noreferrer"
              class="pt-0.5 text-2xs text-muted-foreground hover:text-foreground transition-colors leading-tight"
              @click.stop
            >
              {{
                t('profileMenu.osmContributions', {
                  count: osmProfile.osmChangesetCount.toLocaleString(),
                })
              }}
            </a>
          </div>
        </div>
      </div>
      <Separator class="my-1 bg-border" />
    </template>

    <!-- Version footer -->
    <template #footer>
      <Separator class="my-1 bg-border" />
      <div class="flex items-center justify-between gap-2 px-2 pb-1 py-1">
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
