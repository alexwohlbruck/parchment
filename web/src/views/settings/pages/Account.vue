<script setup lang="ts">
import { useAuthStore } from '@/stores/auth.store'
import { useCommandStore } from '@/stores/command.store'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useAuthService } from '@/services/auth.service'
import { CommandName } from '@/stores/command.store'
import { Avatar, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { LanguagesIcon } from 'lucide-vue-next'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SettingsSection, SettingsItem } from '@/components/settings'
import Passkeys from '@/components/auth/Passkeys.vue'
import Sessions from '@/components/auth/Sessions.vue'

const authService = useAuthService()
const authStore = useAuthStore()
const commandStore = useCommandStore()

const { me } = storeToRefs(authStore)
const { locale } = useI18n()

const languageCommand = commandStore.useCommand(CommandName.UPDATE_LANGUAGE)
</script>

<template>
  <div class="flex flex-col gap-4">
    <template v-if="me">
      <SettingsSection :title="$t('settings.account.user.title')">
        <div class="flex items-center gap-2 w-full">
          <Avatar v-if="me.picture" size="sm">
            <AvatarImage :src="me.picture" :alt="me.email" />
          </Avatar>

          <div class="flex flex-col text-nowrap">
            <span class="text-sm font-semibold leading-4">
              {{ me.firstName }} {{ me.lastName }}
            </span>
            <span class="text-xs text-gray-500 leading-4">{{ me.email }}</span>
          </div>

          <div class="flex-1"></div>

          <Button variant="outline" @click="authService.signOut()">
            Sign out
          </Button>
        </div>

        <SettingsItem
          v-if="languageCommand"
          :title="languageCommand.name"
          :description="languageCommand.description"
          :icon="LanguagesIcon"
        >
          <Select v-model="locale">
            <SelectTrigger class="w-fit">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="language in commandStore.getCommandArgumentOptions(
                  CommandName.UPDATE_LANGUAGE,
                  'language',
                )"
                :value="language.value.toString()"
              >
                {{ language.name }}
              </SelectItem>
            </SelectContent>
          </Select>
        </SettingsItem>
      </SettingsSection>

      <Sessions />

      <Passkeys />
    </template>
  </div>
</template>
