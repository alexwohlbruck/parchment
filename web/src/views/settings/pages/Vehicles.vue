<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useVehiclesStore } from '@/stores/vehicles.store'
import { getRoutingMode, VEHICLE_TYPE_LABELS } from '@/lib/vehicle-mode-mapping'
import type { UserVehicle, VehicleType, EnergyType } from '@/types/multimodal.types'
import { SettingsSection, SettingsItem } from '@/components/settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
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
import { useVehicleLocationPicker } from '@/composables/useVehicleLocationPicker'
import {
  CarFrontIcon,
  BikeIcon,
  TruckIcon,
  AccessibilityIcon,
  ZapIcon,
  PlusIcon,
  PencilIcon,
  TrashIcon,
  MapPinIcon,
  CheckIcon,
  CrosshairIcon,
  type LucideIcon,
} from 'lucide-vue-next'

const { t, te } = useI18n()

const vehiclesStore = useVehiclesStore()
const { vehicles, loading } = storeToRefs(vehiclesStore)

// Translated display name for a vehicle type, falling back to the shared
// label constant (then the raw type) for anything not covered by i18n.
function vehicleTypeLabel(type: string): string {
  const key = `settings.vehicles.types.${type}`
  return te(key) ? t(key) : VEHICLE_TYPE_LABELS[type as VehicleType] || type
}

// ── Vehicle type icons ─────────────────────────────────────────────────
const vehicleTypeIcons: Record<string, LucideIcon> = {
  car: CarFrontIcon,
  truck: TruckIcon,
  moped: BikeIcon,
  bike: BikeIcon,
  'e-bike': BikeIcon,
  scooter: BikeIcon,
  'e-scooter': BikeIcon,
  wheelchair: AccessibilityIcon,
}

function getVehicleIcon(type: string): LucideIcon {
  return vehicleTypeIcons[type] || CarFrontIcon
}

function isElectric(type: string): boolean {
  return type === 'e-bike' || type === 'e-scooter'
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
  startPicking(vehicle.id, '/settings/vehicles')
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

function getStalenessClass(vehicle: UserVehicle): string {
  const staleness = vehiclesStore.getLocationStaleness(vehicle)
  switch (staleness) {
    case 'fresh':
    case 'aging':
      return 'text-muted-foreground'
    case 'stale':
      return 'text-yellow-600 dark:text-yellow-500'
    case 'very-stale':
      return 'text-destructive'
    default:
      return 'text-muted-foreground'
  }
}

// Group vehicles by routing mode
const drivingVehicles = computed(() =>
  vehicles.value.filter((v) => getRoutingMode(v.type) === 'driving'),
)
const bikingVehicles = computed(() =>
  vehicles.value.filter((v) => getRoutingMode(v.type) === 'biking'),
)
</script>

<template>
  <SettingsSection
    id="vehicles"
    :title="t('settings.vehicles.title')"
    :description="t('settings.vehicles.description')"
  >
    <!-- Empty state -->
    <div v-if="!loading && vehicles.length === 0" class="py-8 text-center">
      <CarFrontIcon class="mx-auto mb-3 size-10 text-muted-foreground/50" />
      <p class="text-sm text-muted-foreground mb-4">
        {{ t('settings.vehicles.empty') }}
      </p>
      <Button variant="outline" size="sm" @click="openAddDialog">
        <PlusIcon class="size-4 mr-1.5" />
        {{ t('settings.vehicles.add') }}
      </Button>
    </div>

    <!-- Vehicle list -->
    <div v-else class="space-y-2">
      <!-- Driving vehicles -->
      <template v-if="drivingVehicles.length">
        <div v-for="vehicle in drivingVehicles" :key="vehicle.id" class="group flex items-center gap-3 rounded-lg border p-3">
          <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
            <component :is="getVehicleIcon(vehicle.type)" class="size-5 text-foreground" />
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium truncate">
                {{ vehicle.name || vehicleTypeLabel(vehicle.type) }}
              </span>
              <Badge v-if="vehicle.isActive" variant="secondary" class="text-[10px] px-1.5 py-0">
                {{ t('settings.vehicles.active') }}
              </Badge>
              <Badge v-if="isElectric(vehicle.type)" variant="outline" class="text-[10px] px-1.5 py-0">
                <ZapIcon class="size-2.5 mr-0.5" />
                {{ t('settings.vehicles.electric') }}
              </Badge>
            </div>
            <div class="flex items-center gap-1 mt-0.5">
              <MapPinIcon class="size-3" :class="getStalenessClass(vehicle)" />
              <span class="text-xs" :class="getStalenessClass(vehicle)">
                {{ getLocationLabel(vehicle) }}
              </span>
            </div>
          </div>
          <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              v-if="!vehicle.isActive"
              variant="ghost"
              size="icon"
              class="size-7"
              :title="t('settings.vehicles.actions.setActive')"
              @click="handleActivate(vehicle)"
            >
              <CheckIcon class="size-3.5" />
            </Button>
            <Button variant="ghost" size="icon" class="size-7" :title="t('settings.vehicles.actions.setLocation')" @click="handleSetLocation(vehicle)">
              <CrosshairIcon class="size-3.5" />
            </Button>
            <Button variant="ghost" size="icon" class="size-7" :title="t('settings.vehicles.actions.edit')" @click="openEditDialog(vehicle)">
              <PencilIcon class="size-3.5" />
            </Button>
            <Button variant="ghost" size="icon" class="size-7 text-destructive" :title="t('settings.vehicles.actions.delete')" @click="handleDelete(vehicle)">
              <TrashIcon class="size-3.5" />
            </Button>
          </div>
        </div>
      </template>

      <!-- Biking vehicles -->
      <template v-if="bikingVehicles.length">
        <div v-for="vehicle in bikingVehicles" :key="vehicle.id" class="group flex items-center gap-3 rounded-lg border p-3">
          <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
            <component :is="getVehicleIcon(vehicle.type)" class="size-5 text-foreground" />
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium truncate">
                {{ vehicle.name || vehicleTypeLabel(vehicle.type) }}
              </span>
              <Badge v-if="vehicle.isActive" variant="secondary" class="text-[10px] px-1.5 py-0">
                {{ t('settings.vehicles.active') }}
              </Badge>
              <Badge v-if="isElectric(vehicle.type)" variant="outline" class="text-[10px] px-1.5 py-0">
                <ZapIcon class="size-2.5 mr-0.5" />
                {{ t('settings.vehicles.electric') }}
              </Badge>
            </div>
            <div class="flex items-center gap-1 mt-0.5">
              <MapPinIcon class="size-3" :class="getStalenessClass(vehicle)" />
              <span class="text-xs" :class="getStalenessClass(vehicle)">
                {{ getLocationLabel(vehicle) }}
              </span>
            </div>
          </div>
          <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              v-if="!vehicle.isActive"
              variant="ghost"
              size="icon"
              class="size-7"
              :title="t('settings.vehicles.actions.setActive')"
              @click="handleActivate(vehicle)"
            >
              <CheckIcon class="size-3.5" />
            </Button>
            <Button variant="ghost" size="icon" class="size-7" :title="t('settings.vehicles.actions.setLocation')" @click="handleSetLocation(vehicle)">
              <CrosshairIcon class="size-3.5" />
            </Button>
            <Button variant="ghost" size="icon" class="size-7" :title="t('settings.vehicles.actions.edit')" @click="openEditDialog(vehicle)">
              <PencilIcon class="size-3.5" />
            </Button>
            <Button variant="ghost" size="icon" class="size-7 text-destructive" :title="t('settings.vehicles.actions.delete')" @click="handleDelete(vehicle)">
              <TrashIcon class="size-3.5" />
            </Button>
          </div>
        </div>
      </template>

      <!-- Add button -->
      <Button variant="outline" size="sm" class="w-full mt-2" @click="openAddDialog">
        <PlusIcon class="size-4 mr-1.5" />
        {{ t('settings.vehicles.add') }}
      </Button>
    </div>
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
