<script setup lang="ts">
import { ref } from 'vue'
import { cn } from '@/lib/utils'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DateFormatter,
  type DateValue,
  getLocalTimeZone,
} from '@internationalized/date'
import { CalendarIcon } from 'lucide-vue-next'

const value = ref<DateValue>()
const df = new DateFormatter('en-US', {
  // TODO: Internationalize the locale
  dateStyle: 'long',
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center space-x-2">
      <Checkbox id="leave-now" />
      <label
        for="leave-now"
        class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
      >
        Leave now

        <!-- <Popover>
          <PopoverTrigger as-child>
            <button
              variant="outline"
              :class="
                cn(
                  'justify-start text-left font-normal',
                  !value && 'text-muted-foreground',
                )
              "
            >
              <CalendarIcon class="mr-2 h-4 w-4" />
              {{
                value
                  ? df.format(value.toDate(getLocalTimeZone()))
                  : 'Pick a date'
              }}
            </button>
          </PopoverTrigger>
          <PopoverContent class="w-auto p-0">
            <Calendar v-model="value" initial-focus />
          </PopoverContent>
        </Popover> -->
      </label>
    </div>
    <div class="flex items-center space-x-2">
      <Checkbox id="depart-at" />
      <label
        for="leave-now"
        class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
      >
        Depart at
      </label>
    </div>
    <div class="flex items-center space-x-2">
      <Checkbox id="arrive-by" />
      <label
        for="leave-now"
        class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
      >
        Arrive by
      </label>
    </div>
  </div>
</template>
