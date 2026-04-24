<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import IntegrationTile from '@/components/integration/IntegrationTile.vue'
import {
  LoaderCircleIcon,
  SearchIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  FilterIcon,
  XIcon,
  CheckIcon,
  DollarSignIcon,
  CloudIcon,
  UsersIcon,
  LinkIcon,
  PuzzleIcon,
  ShieldCheckIcon,
} from 'lucide-vue-next'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { useIntegrationService } from '@/services/integration.service'
import { useAppService } from '@/services/app.service'
import { useAuthService } from '@/services/auth.service'
import { PermissionId } from '@/types/auth.types'
import {
  useIntegrationFilters,
  type SortField,
} from '@/composables/useIntegrationFilters'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { SettingsSection } from '@/components/settings'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuSeparator,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const integrationStore = useIntegrationsStore()
const integrationService = useIntegrationService()
const authService = useAuthService()
const { toast } = useAppService()

// Filter + sort state, active-chip derivations, and the sorted/filtered list
// all live in the composable. Bind directly; the template doesn't need to
// know how they're wired.
const {
  searchQuery,
  selectedCapabilities,
  costFilter,
  hostingFilter,
  scopeFilter,
  statusFilter,
  encryptionFilter,
  sortField,
  sortAscending,
  allCapabilities,
  dropdownFilterChips,
  totalFilterCount,
  hasActiveFilters,
  filteredIntegrations,
  toggleFilter,
  removeFilter,
  clearAllFilters,
} = useIntegrationFilters()

// Handle OAuth callback query params
function handleOAuthCallback() {
  const osmStatus = route.query.osm as string | undefined
  if (!osmStatus) return

  if (osmStatus === 'connected') {
    toast.success(t('settings.integrations.osm.connected'))
  } else if (osmStatus === 'error') {
    const message = route.query.message as string | undefined
    toast.error(message || t('settings.integrations.osm.authError'))
  }

  router.replace({ query: {} })
}

onMounted(async () => {
  handleOAuthCallback()

  try {
    await integrationService.fetchAvailableIntegrations()
    await integrationService.fetchConfiguredIntegrations()
  } catch (error) {
    console.error('Failed to load integrations:', error)
  }
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <div
      v-if="
        integrationStore.isLoadingAvailable ||
        integrationStore.isLoadingConfigured
      "
      class="flex justify-center items-center py-10"
    >
      <LoaderCircleIcon class="animate-spin h-8 w-8 text-primary" />
    </div>

    <div v-else>
      <SettingsSection
        :title="t('settings.integrations.title')"
        :description="t('settings.integrations.description')"
        :frame="false"
        :shadow="false"
      >
        <!-- Toolbar -->
        <div class="flex flex-col gap-3">
          <!-- Search, filter, and sort row -->
          <div class="flex items-center gap-2">
            <!-- Search -->
            <div class="relative flex-1">
              <SearchIcon
                class="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none"
              />
              <Input
                v-model="searchQuery"
                :placeholder="t('settings.integrations.searchPlaceholder')"
                class="pl-9 h-9"
              />
            </div>

            <!-- Filter dropdown -->
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button
                  variant="outline"
                  size="icon-sm"
                  class="shrink-0 relative size-9"
                >
                  <FilterIcon class="size-4" />
                  <Badge
                    v-if="totalFilterCount > 0"
                    variant="primary"
                    class="absolute -top-1.5 -right-1.5 px-1 py-0 text-[10px] min-w-4 h-4 justify-center"
                  >
                    {{ totalFilterCount }}
                  </Badge>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" class="w-52">
                <!-- Capabilities submenu -->
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <PuzzleIcon class="size-4 mr-2 text-muted-foreground" />
                    {{ t('settings.integrations.capabilities.title') }}
                    <Badge
                      v-if="selectedCapabilities.length > 0"
                      variant="primary"
                      class="ml-auto px-1.5 py-0 text-[10px] min-w-5 justify-center"
                    >
                      {{ selectedCapabilities.length }}
                    </Badge>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent class="max-h-64 overflow-y-auto">
                    <DropdownMenuItem
                      v-for="cap in allCapabilities"
                      :key="cap.id"
                      @select="
                        (e: Event) => {
                          e.preventDefault()
                          toggleFilter('capability', cap.id)
                        }
                      "
                    >
                      <CheckIcon
                        v-if="selectedCapabilities.includes(cap.id)"
                        class="size-4 mr-2"
                      />
                      <span v-else class="size-4 mr-2" />
                      {{ cap.label }}
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>

                <!-- Cost submenu -->
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <DollarSignIcon class="size-4 mr-2 text-muted-foreground" />
                    {{ t('settings.integrations.filter.cost') }}
                    <Badge
                      v-if="costFilter.length > 0"
                      variant="primary"
                      class="ml-auto px-1.5 py-0 text-[10px] min-w-5 justify-center"
                    >
                      {{ costFilter.length }}
                    </Badge>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem
                      @select="
                        (e: Event) => {
                          e.preventDefault()
                          toggleFilter('cost', 'free')
                        }
                      "
                    >
                      <CheckIcon
                        v-if="costFilter.includes('free')"
                        class="size-4 mr-2"
                      />
                      <span v-else class="size-4 mr-2" />
                      {{ t('settings.integrations.filter.free') }}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @select="
                        (e: Event) => {
                          e.preventDefault()
                          toggleFilter('cost', 'paid')
                        }
                      "
                    >
                      <CheckIcon
                        v-if="costFilter.includes('paid')"
                        class="size-4 mr-2"
                      />
                      <span v-else class="size-4 mr-2" />
                      {{ t('settings.integrations.filter.paid') }}
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>

                <!-- Hosting submenu -->
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <CloudIcon class="size-4 mr-2 text-muted-foreground" />
                    {{ t('settings.integrations.filter.hosting') }}
                    <Badge
                      v-if="hostingFilter.length > 0"
                      variant="primary"
                      class="ml-auto px-1.5 py-0 text-[10px] min-w-5 justify-center"
                    >
                      {{ hostingFilter.length }}
                    </Badge>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem
                      @select="
                        (e: Event) => {
                          e.preventDefault()
                          toggleFilter('hosting', 'cloud')
                        }
                      "
                    >
                      <CheckIcon
                        v-if="hostingFilter.includes('cloud')"
                        class="size-4 mr-2"
                      />
                      <span v-else class="size-4 mr-2" />
                      {{ t('settings.integrations.filter.cloud') }}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @select="
                        (e: Event) => {
                          e.preventDefault()
                          toggleFilter('hosting', 'selfHosted')
                        }
                      "
                    >
                      <CheckIcon
                        v-if="hostingFilter.includes('selfHosted')"
                        class="size-4 mr-2"
                      />
                      <span v-else class="size-4 mr-2" />
                      {{ t('settings.integrations.filter.selfHosted') }}
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>

                <!-- Scope submenu -->
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <UsersIcon class="size-4 mr-2 text-muted-foreground" />
                    {{ t('settings.integrations.filter.scope') }}
                    <Badge
                      v-if="scopeFilter.length > 0"
                      variant="primary"
                      class="ml-auto px-1.5 py-0 text-[10px] min-w-5 justify-center"
                    >
                      {{ scopeFilter.length }}
                    </Badge>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem
                      @select="
                        (e: Event) => {
                          e.preventDefault()
                          toggleFilter('scope', 'system')
                        }
                      "
                    >
                      <CheckIcon
                        v-if="scopeFilter.includes('system')"
                        class="size-4 mr-2"
                      />
                      <span v-else class="size-4 mr-2" />
                      {{ t('settings.integrations.filter.system') }}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @select="
                        (e: Event) => {
                          e.preventDefault()
                          toggleFilter('scope', 'user')
                        }
                      "
                    >
                      <CheckIcon
                        v-if="scopeFilter.includes('user')"
                        class="size-4 mr-2"
                      />
                      <span v-else class="size-4 mr-2" />
                      {{ t('settings.integrations.filter.user') }}
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>

                <!-- Status submenu -->
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <LinkIcon class="size-4 mr-2 text-muted-foreground" />
                    {{ t('settings.integrations.filter.status') }}
                    <Badge
                      v-if="statusFilter.length > 0"
                      variant="primary"
                      class="ml-auto px-1.5 py-0 text-[10px] min-w-5 justify-center"
                    >
                      {{ statusFilter.length }}
                    </Badge>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem
                      @select="
                        (e: Event) => {
                          e.preventDefault()
                          toggleFilter('status', 'connected')
                        }
                      "
                    >
                      <CheckIcon
                        v-if="statusFilter.includes('connected')"
                        class="size-4 mr-2"
                      />
                      <span v-else class="size-4 mr-2" />
                      {{ t('settings.integrations.filter.connected') }}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @select="
                        (e: Event) => {
                          e.preventDefault()
                          toggleFilter('status', 'notConnected')
                        }
                      "
                    >
                      <CheckIcon
                        v-if="statusFilter.includes('notConnected')"
                        class="size-4 mr-2"
                      />
                      <span v-else class="size-4 mr-2" />
                      {{ t('settings.integrations.filter.notConnected') }}
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>

                <!-- Encryption submenu -->
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <ShieldCheckIcon
                      class="size-4 mr-2 text-muted-foreground"
                    />
                    {{ t('settings.integrations.filter.encryption') }}
                    <Badge
                      v-if="encryptionFilter.length > 0"
                      variant="primary"
                      class="ml-auto px-1.5 py-0 text-[10px] min-w-5 justify-center"
                    >
                      {{ encryptionFilter.length }}
                    </Badge>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem
                      @select="
                        (e: Event) => {
                          e.preventDefault()
                          toggleFilter('encryption', 'server')
                        }
                      "
                    >
                      <CheckIcon
                        v-if="encryptionFilter.includes('server')"
                        class="size-4 mr-2"
                      />
                      <span v-else class="size-4 mr-2" />
                      {{ t('settings.integrations.filter.serverManaged') }}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @select="
                        (e: Event) => {
                          e.preventDefault()
                          toggleFilter('encryption', 'e2ee')
                        }
                      "
                    >
                      <CheckIcon
                        v-if="encryptionFilter.includes('e2ee')"
                        class="size-4 mr-2"
                      />
                      <span v-else class="size-4 mr-2" />
                      {{ t('settings.integrations.filter.endToEnd') }}
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>

                <!-- Reset -->
                <template v-if="totalFilterCount > 0">
                  <DropdownMenuSeparator />
                  <DropdownMenuItem @select="clearAllFilters">
                    <XIcon class="size-4 mr-2 text-muted-foreground" />
                    {{ t('settings.integrations.filter.reset') }}
                  </DropdownMenuItem>
                </template>
              </DropdownMenuContent>
            </DropdownMenu>

            <!-- Sort dropdown -->
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button
                  variant="outline"
                  size="icon-sm"
                  class="shrink-0 size-9"
                >
                  <ArrowUpDownIcon class="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" class="w-48">
                <DropdownMenuLabel
                  class="text-xs text-muted-foreground font-normal"
                >
                  {{ t('settings.integrations.sort.label') }}
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  :model-value="sortField"
                  @update:model-value="(v) => (sortField = v as SortField)"
                >
                  <DropdownMenuRadioItem
                    value="popularity"
                    class="flex items-center justify-between pr-1.5"
                  >
                    <span>{{
                      t('settings.integrations.sort.popularity')
                    }}</span>
                    <button
                      v-if="sortField === 'popularity'"
                      class="p-0.5 rounded hover:bg-muted transition-colors"
                      @click.stop="sortAscending = !sortAscending"
                    >
                      <ArrowUpIcon
                        v-if="sortAscending"
                        class="size-3.5 text-muted-foreground"
                      />
                      <ArrowDownIcon
                        v-else
                        class="size-3.5 text-muted-foreground"
                      />
                    </button>
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem
                    value="alphabetical"
                    class="flex items-center justify-between pr-1.5"
                  >
                    <span>{{
                      t('settings.integrations.sort.alphabetical')
                    }}</span>
                    <button
                      v-if="sortField === 'alphabetical'"
                      class="p-0.5 rounded hover:bg-muted transition-colors"
                      @click.stop="sortAscending = !sortAscending"
                    >
                      <ArrowUpIcon
                        v-if="sortAscending"
                        class="size-3.5 text-muted-foreground"
                      />
                      <ArrowDownIcon
                        v-else
                        class="size-3.5 text-muted-foreground"
                      />
                    </button>
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem
                    value="dateModified"
                    class="flex items-center justify-between pr-1.5"
                  >
                    <span>{{
                      t('settings.integrations.sort.dateModified')
                    }}</span>
                    <button
                      v-if="sortField === 'dateModified'"
                      class="p-0.5 rounded hover:bg-muted transition-colors"
                      @click.stop="sortAscending = !sortAscending"
                    >
                      <ArrowUpIcon
                        v-if="sortAscending"
                        class="size-3.5 text-muted-foreground"
                      />
                      <ArrowDownIcon
                        v-else
                        class="size-3.5 text-muted-foreground"
                      />
                    </button>
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <!-- Capability quick-filter chips -->
          <div class="flex items-center gap-1.5 flex-wrap">
            <button
              v-for="cap in allCapabilities"
              :key="cap.id"
              :class="[
                'rounded-full text-xs h-7 px-2.5 border font-medium transition-colors cursor-pointer',
                selectedCapabilities.includes(cap.id)
                  ? 'bg-primary-100 text-primary-800 border-primary-300 dark:bg-primary-800 dark:text-primary-200 dark:border-primary-600 shadow-xs'
                  : 'bg-transparent text-muted-foreground border-border hover:bg-muted hover:text-foreground',
              ]"
              @click="toggleFilter('capability', cap.id)"
            >
              {{ cap.label }}
            </button>
          </div>

          <!-- Active filter chips (excludes capabilities, shown as toggles above) -->
          <div
            v-if="dropdownFilterChips.length > 0"
            class="flex items-center gap-1.5 flex-wrap"
          >
            <button
              v-for="chip in dropdownFilterChips"
              :key="chip.key"
              class="inline-flex items-center gap-1 rounded-full border border-border bg-background text-foreground px-2.5 py-0.5 text-xs font-medium hover:bg-muted transition-colors"
              @click="removeFilter(chip)"
            >
              {{ chip.label }}
              <XIcon class="size-3" />
            </button>
            <button
              class="text-xs text-muted-foreground hover:text-foreground transition-colors px-1"
              @click="clearAllFilters"
            >
              {{ t('settings.integrations.filter.reset') }}
            </button>
          </div>
        </div>

        <!-- Integration grid -->
        <div
          v-if="filteredIntegrations.length === 0"
          class="text-center py-8 text-muted-foreground"
        >
          {{
            hasActiveFilters
              ? t('settings.integrations.noResults')
              : t('settings.integrations.noAvailable')
          }}
        </div>

        <div
          v-else
          class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          <IntegrationTile
            v-for="item in filteredIntegrations"
            :key="item.config?.id || item.integration.id"
            :integration="item.integration"
            :configuration="item.config"
            :disabled="
              !authService.hasPermission(PermissionId.INTEGRATIONS_WRITE_SYSTEM)
            "
          />
        </div>
      </SettingsSection>
    </div>
  </div>
</template>
