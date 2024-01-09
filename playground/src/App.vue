<script setup lang="ts">
// import { RouterLink, RouterView } from 'vue-router'
import { ref, watch } from 'vue'
import NavigationMenu from './components/organisms/NavigationMenu.vue'
import { useMagicKeys } from '@vueuse/core'
import { useRouter } from 'vue-router'

const router = useRouter()
const keys = useMagicKeys()

const commands = [
  {
    keys: 'm',
    action: () => {
      router.push('/map')
    }
  },
  {
    keys: ['/', 'Meta+k'],
    action: () => {
      router.push('/map/search')
    }
  },
  {
    keys: 'd',
    action: () => {
      router.push('/map/directions')
    }
  },
  {
    keys: 'p',
    action: () => {
      router.push('/places')
    }
  },
  {
    keys: 't',
    action: () => {
      router.push('/timeline')
    }
  },
  {
    keys: 'o',
    action: () => {
      router.push('/offline')
    }
  },
  {
    keys: 'c',
    action: () => {
      router.push('/custom')
    }
  },
  {
    keys: 's',
    action: () => {
      router.push('/settings')
    }
  }
]

for (const command of commands) {
  for (const key of command.keys) {
    // attach key binding to command
    const binding = keys[key]
    if (binding) {
      watch(binding, (value) => {
        if (value) {
          command.action()
        }
      })
    }
  }
}
</script>

<template>
  <div class="flex gap-2 p-2" style="height: 100dvh">
    <NavigationMenu class="h-full z-2" />

    <main class="flex-1">
      <RouterView />
    </main>
  </div>
</template>
