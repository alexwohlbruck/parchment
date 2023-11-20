<script setup lang="ts">
import Menu from 'primevue/menu'
import Avatar from 'primevue/avatar'
import { ref } from 'vue'
import SearchBar from '../molecules/SearchBar.vue'
import KeyboardShorcut from '../atoms/KeyboardShorcut.vue'

import SvgIcon from '@jamescoyle/vue-icon'
import {
  mdiMapOutline,
  mdiMagnify,
  mdiBookmarkOutline,
  mdiHistory,
  mdiMapMarkerMultipleOutline,
  mdiCloudOffOutline,
  mdiAccountSupervisorCircleOutline,
  mdiCogOutline
} from '@mdi/js'

const items = ref([
  {
    separator: true
  },
  {
    label: 'Navigate',
    items: [
      {
        label: 'Map',
        icon: mdiMapOutline,
        shortcut: 'm'
      },
      {
        label: 'Search',
        icon: mdiMagnify,
        shortcut: '/'
      },
      {
        label: 'Places',
        icon: mdiBookmarkOutline,
        shortcut: 'p'
      }
    ]
  },
  {
    label: 'Explore',
    items: [
      {
        label: 'Timeline',
        icon: mdiHistory,
        shortcut: 't'
      },
      {
        label: 'Offline maps',
        shortcut: 'o',
        icon: mdiCloudOffOutline
      },
      {
        label: 'Custom maps',
        shortcut: 'c',
        icon: mdiMapMarkerMultipleOutline
      },
      {
        label: 'Location sharing',
        shortcut: 'l',
        icon: mdiAccountSupervisorCircleOutline
      }
    ]
  },
  {
    label: 'Manage',
    items: [
      {
        label: 'Settings',
        icon: mdiCogOutline,
        shortcut: 's'
      }
    ]
  },
  {
    separator: true
  }
])
</script>

<template>
  <Menu :model="items" class="w-fit">
    <template #start>
      <div class="flex flex-column px-3 py-2">
        <span class="text-primary font-bold text-lg">Parchment</span>
      </div>
    </template>
    <template #submenuheader="{ item }">
      <span class="text-primary font-bold">{{ item.label }}</span>
    </template>
    <template #item="{ item, props }">
      <a v-ripple class="flex align-items-center" v-bind="props.action">
        <svg-icon v-if="item.icon" type="mdi" :path="item.icon"></svg-icon>
        <span class="mx-2 whitespace-nowrap">{{ item.label }}</span>
        <Badge v-if="item.badge" class="ml-auto" :value="item.badge" />
        <KeyboardShorcut v-if="item.shortcut" :shortcut="item.shortcut" />
      </a>
    </template>
    <template #end>
      <button
        v-ripple
        class="relative overflow-hidden w-full p-link flex align-items-center p-2 pl-3 text-color hover:surface-200 border-noround"
      >
        <Avatar
          image="https://alex.wohlbruck.com/img/me.0e1a082e.jpg"
          class="mr-2"
          shape="circle"
        />
        <span class="inline-flex flex-column">
          <span class="font-bold">Alex Wohlbruck</span>
          <span class="text-sm">Admin</span>
        </span>
      </button>
    </template>
  </Menu>
</template>
