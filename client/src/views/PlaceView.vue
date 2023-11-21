<script setup lang="ts">
import Card from 'primevue/card'
import Button from 'primevue/button'
import Rating from 'primevue/rating'
import { mdiBookmarkOutline, mdiPhoneOutline, mdiShareOutline, mdiWeb } from '@mdi/js'
import SvgIcon from '@jamescoyle/vue-icon'

const rating = 4.5
</script>

<template>
  <Card class="w-25rem overflow-hidden">
    <template #header>
      <img
        alt="user header"
        src="https://s3-media0.fl.yelpcdn.com/bphoto/SS4romTGXbpvCAgwcwlcDg/o.jpg"
        class="w-full rounded"
      />
    </template>
    <template #title>Sabor Latin Street Grill</template>
    <template #subtitle> Latin American, Mexican </template>
    <template #content>
      <div class="col gap-3 p-0">
        <Rating v-model="rating" readonly :cancel="false" />
        <span><span class="text-primary font-bold">Open</span> 11:00 AM - 10:00 PM</span>

        <div class="flex gap-2">
          <Button outlined rounded class="p-button-icon-only" aria-label="Call">
            <svg-icon type="mdi" :path="mdiPhoneOutline"></svg-icon>
          </Button>
          <Button outlined rounded class="p-button-icon-only" aria-label="Website">
            <svg-icon type="mdi" :path="mdiWeb"></svg-icon>
          </Button>
          <Button outlined rounded class="p-button-icon-only" aria-label="Save">
            <svg-icon type="mdi" :path="mdiBookmarkOutline"></svg-icon>
          </Button>
          <Button outlined rounded class="p-button-icon-only" aria-label="Share">
            <svg-icon type="mdi" :path="mdiShareOutline"></svg-icon>
          </Button>
        </div>

        <p class="m-0">
          Popular counter-serve outpost featuring classic Mexican plates & margaritas in a
          contemporary space.
        </p>
      </div>
    </template>
    <!-- <template #footer>
      <Button icon="pi pi-check" label="Save" />
      <Button icon="pi pi-times" label="Cancel" severity="secondary" style="margin-left: 0.5em" />
    </template> -->
  </Card>
</template>
