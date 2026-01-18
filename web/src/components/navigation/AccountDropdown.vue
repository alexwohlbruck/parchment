<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth.store'
import { useCommandStore, CommandName } from '@/stores/command.store'
import { useThemeStore } from '@/stores/theme.store'
import { useExternalLink } from '@/composables/useExternalLink'
import { useAuthService } from '@/services/auth.service'
import { APP_VERSION } from '@/lib/constants'

import { Switch } from '@/components/ui/switch'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  DropdownMenuPortal,
} from '@/components/ui/dropdown-menu'
import {
  SettingsIcon,
  SunIcon,
  MoonIcon,
  LanguagesIcon,
  HelpCircleIcon,
  LogOutIcon,
  ChevronUpIcon,
  CheckIcon,
} from 'lucide-vue-next'

const props = defineProps<{
  mini?: boolean
}>()

const router = useRouter()
const { t, locale } = useI18n()
const authStore = useAuthStore()
const { me } = storeToRefs(authStore)
const { openExternalLink } = useExternalLink()
const commandStore = useCommandStore()
const themeStore = useThemeStore()
const { isDark } = storeToRefs(themeStore)
const { toggleDark } = themeStore
const authService = useAuthService()

// Language options from command store
const languageOptions = computed(() =>
  commandStore.getCommandArgumentOptions(CommandName.UPDATE_LANGUAGE, 'language')
)
</script>

<template>
  <DropdownMenu v-if="me">
    <DropdownMenuTrigger as-child>
      <button
        :class="
          cn(
            'w-full px-1 py-2 rounded-lg flex flex-row justify-center gap-2 hover:bg-foreground/5 cursor-pointer',
          )
        "
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

        <ChevronUpIcon v-if="!mini" class="size-4 text-muted-foreground self-center" />
      </button>
    </DropdownMenuTrigger>

    <DropdownMenuContent
      class="w-56"
      :side="mini ? 'right' : 'top'"
      :align="mini ? 'end' : 'start'"
    >
      <!-- User info header -->
      <DropdownMenuLabel class="font-normal">
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
      </DropdownMenuLabel>

      <DropdownMenuSeparator />

      <!-- Dark mode toggle -->
      <DropdownMenuItem
        class="flex items-center justify-between cursor-pointer"
        @click.prevent="toggleDark()"
        @select.prevent
      >
        <div class="flex items-center gap-2">
          <MoonIcon v-if="isDark" class="size-4" />
          <SunIcon v-else class="size-4" />
          <span>{{ t('settings.appearance.appTheme.theme.title') }}</span>
        </div>
        <Switch
          :model-value="isDark"
          @update:model-value="toggleDark"
          @click.stop
          class="scale-75"
        />
      </DropdownMenuItem>

      <!-- Settings -->
      <DropdownMenuItem
        class="cursor-pointer"
        @click="router.push('/settings')"
      >
        <SettingsIcon class="size-4" />
        <span>{{ t('settings.title') }}</span>
      </DropdownMenuItem>

      <!-- Language submenu -->
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <LanguagesIcon class="size-4" />
          <span>{{ t('palette.commands.updateLanguage.name') }}</span>
        </DropdownMenuSubTrigger>
        <DropdownMenuPortal>
          <DropdownMenuSubContent>
            <DropdownMenuItem
              v-for="lang in languageOptions"
              :key="lang.value"
              class="cursor-pointer flex items-center justify-between"
              @click="locale = lang.value.toString()"
            >
              <span>{{ lang.name }}</span>
              <CheckIcon
                v-if="locale === lang.value"
                class="size-4 text-primary"
              />
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuPortal>
      </DropdownMenuSub>

      <!-- Need help -->
      <DropdownMenuItem
        class="cursor-pointer"
        @click="openExternalLink('https://github.com/alexwohlbruck/parchment/issues', '_blank')"
      >
        <HelpCircleIcon class="size-4" />
        <span>{{ t('navigation.needHelp') }}</span>
      </DropdownMenuItem>

      <DropdownMenuSeparator />

      <!-- Sign out -->
      <DropdownMenuItem
        class="cursor-pointer text-destructive focus:text-destructive"
        @click="authService.signOut()"
      >
        <LogOutIcon class="size-4" />
        <span>{{ t('palette.commands.signOut.name') }}</span>
      </DropdownMenuItem>

      <DropdownMenuSeparator />

      <!-- Version number -->
      <div class="px-2 py-1.5 text-xs text-muted-foreground">
        v{{ APP_VERSION }}
      </div>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
