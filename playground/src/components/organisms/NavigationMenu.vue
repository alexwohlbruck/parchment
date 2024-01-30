<script setup lang="ts">
import Menu from 'primevue/menu'
import Avatar from 'primevue/avatar'
import { ref } from 'vue'
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
  mdiCogOutline,
  mdiDirections
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
        shortcut: 'm',
        route: '/map'
      },
      {
        label: 'Search',
        icon: mdiMagnify,
        shortcut: '/',
        route: '/map/search'
      },
      {
        label: 'Directions',
        icon: mdiDirections,
        shortcut: 'd',
        route: '/map/directions'
      }
    ]
  },
  {
    label: 'Explore',
    items: [
      {
        label: 'Places',
        icon: mdiBookmarkOutline,
        shortcut: 'p',
        route: '/places'
      },
      {
        label: 'Timeline',
        icon: mdiHistory,
        shortcut: 't',
        route: '/timeline'
      },
      {
        label: 'Offline maps',
        shortcut: 'o',
        icon: mdiCloudOffOutline,
        route: '/offline'
      },
      {
        label: 'Custom maps',
        shortcut: 'c',
        icon: mdiMapMarkerMultipleOutline,
        route: '/custom'
      },
      {
        label: 'People',
        shortcut: 'l',
        icon: mdiAccountSupervisorCircleOutline,
        route: '/people'
      }
    ]
  },
  {
    label: 'Manage',
    items: [
      {
        label: 'Settings',
        icon: mdiCogOutline,
        shortcut: 's',
        route: '/settings'
      }
    ]
  },
  {
    separator: true
  }
])
</script>

<template>
  <nav>
    <Menu class="max-h-full w-fit overflow-y-auto shadow-1">
      <template #start>
        <div class="column px-3 py-2">
          <span class="text-primary font-bold text-lg">Parchment</span>
        </div>
      </template>

      <template #submenuheader="{ item }">
        <span class="text-primary font-bold">{{ item.label }}</span>
      </template>

      <template #item="{ item, props }">
        <router-link v-slot="{ href, navigate }" :to="item.route" custom>
          <a v-ripple :href="href" v-bind="props.action" @click="navigate" class="flex gap-2">
            <svg-icon type="mdi" :path="item.icon"></svg-icon>
            <span class="whitespace-nowrap">{{ item.label }}</span>
            <KeyboardShorcut v-if="item.shortcut" :shortcut="item.shortcut" />
          </a>
        </router-link>
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
          <span class="column">
            <span class="font-bold">Alex Wohlbruck</span>
            <span class="text-sm">Admin</span>
          </span>
        </button>
      </template>
    </Menu>
  </nav>
</template>
