<script setup lang="ts">
import { ref, watch } from 'vue'
import H3 from '../../components/ui/typography/H3.vue'
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const projectionLocal = localStorage.getItem('projection') || 'globe'
const projection = ref(projectionLocal)

watch(projection, value => {
  localStorage.setItem('projection', value)
})
</script>

<template>
  <div class="flex flex-col gap-4 w-fit">
    <form class="flex flex-col gap-4">
      <FormField name="projection">
        <FormItem>
          <FormLabel>Map projection</FormLabel>

          <Select v-model="projection">
            <FormControl>
              <SelectTrigger>
                <SelectValue placeholder="Choose an option" />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="globe">Globe</SelectItem>
                <SelectItem value="mercator">Mercator</SelectItem>
                <SelectItem value="equirectangular">
                  Equirectangular
                </SelectItem>
                <SelectItem value="equalEarth">Equal Earth</SelectItem>
                <SelectItem value="naturalEarth">Natural Earth</SelectItem>
                <SelectItem value="winkelTripel">Winkel Tripel</SelectItem>
                <SelectItem value="albers">Albers</SelectItem>
                <SelectItem value="lambertConformalConic">
                  Lambert Conformal Conic
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <!-- <FormDescription> The default app theme </FormDescription> -->
          <FormMessage />
        </FormItem>
      </FormField>
    </form>
  </div>
</template>
