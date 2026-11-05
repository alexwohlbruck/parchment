<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useVehiclesStore } from '@/stores/vehicles.store'
import { getRoutingMode, VEHICLE_TYPE_LABELS } from '@/lib/transit/vehicle-mode-mapping'
import type { UserVehicle, VehicleType, EnergyType } from '@/types/multimodal.types'
import { SettingsSection, SettingsItem } from '@/components/settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import Caption from '@/components/ui/typography/Caption.vue'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useVehicleLocationPicker } from '@/composables/transit/useVehicleLocationPicker'
import {
  CheckIcon,
  CrosshairIcon,
  EllipsisIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from 'lucide-vue-next'
import { getVehicleIcon } from '@/lib/directions/travel-mode-icons'

const { t, te } = useI18n()

const vehiclesStore = useVehiclesStore()
const { vehicles, loading } = storeToRefs(vehiclesStore)

// Translated display name for a vehicle type, falling back to the shared
// label constant (then the raw type) for anything not covered by i18n.
function vehicleTypeLabel(type: string): string {
  const key = `settings.vehicles.types.${type}`
  return te(key) ? t(key) : VEHICLE_TYPE_LABELS[type as VehicleType] || type
}

// ── Dialog state ───────────────────────────────────────────────────────
const showDialog = ref(false)
const editingVehicle = ref<UserVehicle | null>(null)
const formName = ref('')
const formType = ref<string>('car')
const formEnergyType = ref<string>('')
const saving = ref(false)

const isEditing = computed(() => editingVehicle.value !== null)

const vehicleTypeValues: VehicleType[] = [
  'car',
  'truck',
  'moped',
  'bike',
  'e-bike',
  'scooter',
  'e-scooter',
]

const energyTypeValues: EnergyType[] = ['gas', 'diesel', 'electric', 'hybrid']

// Whether the current formType should show an energy type selector
const showEnergyType = computed(() =>
  ['car', 'truck', 'moped'].includes(formType.value),
)

function openAddDialog() {
  editingVehicle.value = null
  formName.value = ''
  formType.value = 'car'
  formEnergyType.value = ''
  showDialog.value = true
}

function openEditDialog(vehicle: UserVehicle) {
  editingVehicle.value = vehicle
  formName.value = vehicle.name || ''
  formType.value = vehicle.type
  formEnergyType.value = vehicle.energyType || ''
  showDialog.value = true
}

async function saveVehicle() {
  saving.value = true
  try {
    if (isEditing.value) {
      await vehiclesStore.updateVehicle(editingVehicle.value!.id, {
        name: formName.value || null,
        type: formType.value,
        energyType: showEnergyType.value ? formEnergyType.value || null : null,
      })
    } else {
      await vehiclesStore.createVehicle({
        name: formName.value || undefined,
        type: formType.value,
        energyType: showEnergyType.value ? formEnergyType.value || undefined : undefined,
      })
    }
    showDialog.value = false
  } finally {
    saving.value = false
  }
}

async function handleDelete(vehicle: UserVehicle) {
  await vehiclesStore.deleteVehicle(vehicle.id)
}

const { startPicking } = useVehicleLocationPicker()

async function handleActivate(vehicle: UserVehicle) {
  await vehiclesStore.setActiveVehicle(vehicle.id)
}

function handleSetLocation(vehicle: UserVehicle) {
  startPicking(vehicle.id, '/settings/navigation#vehicles')
}

function formatRelativeTime(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return t('settings.vehicles.time.justNow')
  if (minutes < 60) return t('settings.vehicles.time.minutesAgo', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('settings.vehicles.time.hoursAgo', { count: hours })
  const days = Math.floor(hours / 24)
  return t('settings.vehicles.time.daysAgo', { count: days })
}

function getLocationLabel(vehicle: UserVehicle): string {
  if (!vehicle.lastKnownLocation) return t('settings.vehicles.location.notSet')
  if (!vehicle.locationUpdatedAt) return t('settings.vehicles.location.set')
  return t('settings.vehicles.location.updated', {
    time: formatRelativeTime(vehicle.locationUpdatedAt),
  })
}

function vehicleDescription(vehicle: UserVehicle): string {
  const location = getLocationLabel(vehicle)
  return vehicle.name ? `${vehicleTypeLabel(vehicle.type)} · ${location}` : location
}

const ROUTING_MODE_ORDER = ['driving', 'biking']

const sortedVehicles = computed(() =>
  [...vehicles.value].sort(
    (a, b) =>
      ROUTING_MODE_ORDER.indexOf(getRoutingMode(a.type)) - ROUTING_MODE_ORDER.indexOf(getRoutingMode(b.type)),
  ),
)
</script>

<template>
  <SettingsSection
    id="vehicles"
    :title="t('settings.vehicles.title')"
    :description="t('settings.vehicles.description')"
  >
    <template #actions>
      <Button variant="outline" size="sm" @click="openAddDialog">
        <PlusIcon class="size-4" />
        {{ t('settings.vehicles.add') }}
      </Button>
    </template>

    <Caption v-if="!loading && vehicles.length === 0">{{ t('settings.vehicles.empty') }}</Caption>

    <SettingsItem
      v-for="vehicle in sortedVehicles"
      :key="vehicle.id"
      :title="vehicle.name || vehicleTypeLabel(vehicle.type)"
      :description="vehicleDescription(vehicle)"
      :icon="getVehicleIcon(vehicle.type)"
      :badge="vehicle.isActive ? t('settings.vehicles.active') : undefined"
      badge-variant="secondary"
    >
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="ghost" size="icon-sm" :title="t('settings.vehicles.actions.more')">
            <EllipsisIcon class="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem v-if="!vehicle.isActive" @click="handleActivate(vehicle)">
            <CheckIcon class="size-4" />
            {{ t('settings.vehicles.actions.setActive') }}
          </DropdownMenuItem>
          <DropdownMenuItem @click="handleSetLocation(vehicle)">
            <CrosshairIcon class="size-4" />
            {{ t('settings.vehicles.actions.setLocation') }}
          </DropdownMenuItem>
          <DropdownMenuItem @click="openEditDialog(vehicle)">
            <PencilIcon class="size-4" />
            {{ t('settings.vehicles.actions.edit') }}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem class="text-destructive focus:text-destructive" @click="handleDelete(vehicle)">
            <TrashIcon class="size-4" />
            {{ t('settings.vehicles.actions.delete') }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SettingsItem>
  </SettingsSection>

  <!-- Add/Edit dialog -->
  <Dialog v-model:open="showDialog">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ isEditing ? t('settings.vehicles.dialog.editTitle') : t('settings.vehicles.dialog.addTitle') }}</DialogTitle>
        <DialogDescription>
          {{ isEditing ? t('settings.vehicles.dialog.editDescription') : t('settings.vehicles.dialog.addDescription') }}
        </DialogDescription>
      </DialogHeader>

      <div class="grid gap-4 py-2">
        <div class="grid gap-2">
          <Label for="vehicle-name">{{ t('settings.vehicles.form.name') }}</Label>
          <Input
            id="vehicle-name"
            v-model="formName"
            :placeholder="t('settings.vehicles.form.namePlaceholder')"
          />
        </div>

        <div class="grid gap-2">
          <Label for="vehicle-type">{{ t('settings.vehicles.form.type') }}</Label>
          <Select v-model="formType">
            <SelectTrigger id="vehicle-type">
              <SelectValue :placeholder="t('settings.vehicles.form.typePlaceholder')" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem
                  v-for="vt in vehicleTypeValues"
                  :key="vt"
                  :value="vt"
                >
                  {{ vehicleTypeLabel(vt) }}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <div v-if="showEnergyType" class="grid gap-2">
          <Label for="vehicle-energy">{{ t('settings.vehicles.form.fuelType') }}</Label>
          <Select v-model="formEnergyType">
            <SelectTrigger id="vehicle-energy">
              <SelectValue :placeholder="t('settings.vehicles.form.fuelTypePlaceholder')" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem
                  v-for="et in energyTypeValues"
                  :key="et"
                  :value="et"
                >
                  {{ t(`settings.vehicles.energyTypes.${et}`) }}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="showDialog = false">{{ t('general.cancel') }}</Button>
        <Button :disabled="saving" @click="saveVehicle">
          {{ isEditing ? t('general.save') : t('general.add') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
