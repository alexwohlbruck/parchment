<script setup lang="ts">
import { ref, computed } from 'vue'
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

const vehiclesStore = useVehiclesStore()
const { vehicles, loading } = storeToRefs(vehiclesStore)

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

const vehicleTypes: { value: VehicleType; label: string }[] = [
  { value: 'car', label: 'Car' },
  { value: 'truck', label: 'Truck' },
  { value: 'moped', label: 'Moped' },
  { value: 'bike', label: 'Bike' },
  { value: 'e-bike', label: 'E-bike' },
  { value: 'scooter', label: 'Scooter' },
  { value: 'e-scooter', label: 'E-scooter' },
]

const energyTypes: { value: EnergyType; label: string }[] = [
  { value: 'gas', label: 'Gas' },
  { value: 'diesel', label: 'Diesel' },
  { value: 'electric', label: 'Electric' },
  { value: 'hybrid', label: 'Hybrid' },
]

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
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function getLocationLabel(vehicle: UserVehicle): string {
  if (!vehicle.lastKnownLocation) return 'Location not set'
  if (!vehicle.locationUpdatedAt) return 'Location set'
  return `Updated ${formatRelativeTime(vehicle.locationUpdatedAt)}`
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
    title="My Vehicles"
    description="Manage your vehicles for trip planning. Active vehicles are used when planning routes with known vehicle locations."
  >
    <!-- Empty state -->
    <div v-if="!loading && vehicles.length === 0" class="py-8 text-center">
      <CarFrontIcon class="mx-auto mb-3 size-10 text-muted-foreground/50" />
      <p class="text-sm text-muted-foreground mb-4">
        No vehicles added yet. Add your car or bike to get personalized routes that start from your vehicle's location.
      </p>
      <Button variant="outline" size="sm" @click="openAddDialog">
        <PlusIcon class="size-4 mr-1.5" />
        Add vehicle
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
                {{ vehicle.name || VEHICLE_TYPE_LABELS[vehicle.type as VehicleType] || vehicle.type }}
              </span>
              <Badge v-if="vehicle.isActive" variant="secondary" class="text-[10px] px-1.5 py-0">
                active
              </Badge>
              <Badge v-if="isElectric(vehicle.type)" variant="outline" class="text-[10px] px-1.5 py-0">
                <ZapIcon class="size-2.5 mr-0.5" />
                electric
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
              title="Set as active"
              @click="handleActivate(vehicle)"
            >
              <CheckIcon class="size-3.5" />
            </Button>
            <Button variant="ghost" size="icon" class="size-7" title="Set location on map" @click="handleSetLocation(vehicle)">
              <CrosshairIcon class="size-3.5" />
            </Button>
            <Button variant="ghost" size="icon" class="size-7" title="Edit" @click="openEditDialog(vehicle)">
              <PencilIcon class="size-3.5" />
            </Button>
            <Button variant="ghost" size="icon" class="size-7 text-destructive" title="Delete" @click="handleDelete(vehicle)">
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
                {{ vehicle.name || VEHICLE_TYPE_LABELS[vehicle.type as VehicleType] || vehicle.type }}
              </span>
              <Badge v-if="vehicle.isActive" variant="secondary" class="text-[10px] px-1.5 py-0">
                active
              </Badge>
              <Badge v-if="isElectric(vehicle.type)" variant="outline" class="text-[10px] px-1.5 py-0">
                <ZapIcon class="size-2.5 mr-0.5" />
                electric
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
              title="Set as active"
              @click="handleActivate(vehicle)"
            >
              <CheckIcon class="size-3.5" />
            </Button>
            <Button variant="ghost" size="icon" class="size-7" title="Set location on map" @click="handleSetLocation(vehicle)">
              <CrosshairIcon class="size-3.5" />
            </Button>
            <Button variant="ghost" size="icon" class="size-7" title="Edit" @click="openEditDialog(vehicle)">
              <PencilIcon class="size-3.5" />
            </Button>
            <Button variant="ghost" size="icon" class="size-7 text-destructive" title="Delete" @click="handleDelete(vehicle)">
              <TrashIcon class="size-3.5" />
            </Button>
          </div>
        </div>
      </template>

      <!-- Add button -->
      <Button variant="outline" size="sm" class="w-full mt-2" @click="openAddDialog">
        <PlusIcon class="size-4 mr-1.5" />
        Add vehicle
      </Button>
    </div>
  </SettingsSection>

  <!-- Add/Edit dialog -->
  <Dialog v-model:open="showDialog">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ isEditing ? 'Edit vehicle' : 'Add vehicle' }}</DialogTitle>
        <DialogDescription>
          {{ isEditing ? 'Update your vehicle details.' : 'Add a vehicle to use with trip planning.' }}
        </DialogDescription>
      </DialogHeader>

      <div class="grid gap-4 py-2">
        <div class="grid gap-2">
          <Label for="vehicle-name">Name (optional)</Label>
          <Input
            id="vehicle-name"
            v-model="formName"
            placeholder="e.g. Blue Honda"
          />
        </div>

        <div class="grid gap-2">
          <Label for="vehicle-type">Type</Label>
          <Select v-model="formType">
            <SelectTrigger id="vehicle-type">
              <SelectValue placeholder="Select type" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem
                  v-for="vt in vehicleTypes"
                  :key="vt.value"
                  :value="vt.value"
                >
                  {{ vt.label }}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <div v-if="showEnergyType" class="grid gap-2">
          <Label for="vehicle-energy">Fuel type</Label>
          <Select v-model="formEnergyType">
            <SelectTrigger id="vehicle-energy">
              <SelectValue placeholder="Select fuel type" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem
                  v-for="et in energyTypes"
                  :key="et.value"
                  :value="et.value"
                >
                  {{ et.label }}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="showDialog = false">Cancel</Button>
        <Button :disabled="saving" @click="saveVehicle">
          {{ isEditing ? 'Save' : 'Add' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
