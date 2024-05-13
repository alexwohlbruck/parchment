<script setup lang="ts">
import { onMounted, ref } from 'vue'
import dayjs from 'dayjs'
import localizedFormat from 'dayjs/plugin/localizedFormat'
import { Button } from '@/components/ui/button'
import { useAuthService } from '@/services/auth.service'
import { H4 } from '@/components/ui/typography'
import DataTable from '@/components/table/DataTable.vue'
import { PlusIcon } from 'lucide-vue-next'

dayjs.extend(localizedFormat)

const authService = useAuthService()

type Passkey = {
  id: string
  name: string
  publicKey: string
  userId: string
  counter: number
  deviceType: string
  backedUp: boolean
  transports: string
  createdAt: string
}

const passkeys = ref<Passkey[]>([])

const columns = [
  {
    header: 'Name',
    accessorKey: 'name',
  },
  {
    header: 'Backed Up',
    accessorFn: info => (info.backedUp ? 'Yes' : 'No'),
  },
  {
    header: 'Date created',
    accessorFn: info => dayjs(info.createdAt as string).format('LLL'),
  },
]

async function addPasskey() {
  const passkey = await authService.registerPasskey()
  passkeys.value.push(passkey)
}

async function getPasskeys() {
  passkeys.value = await authService.getPasskeys()
}

onMounted(getPasskeys)
</script>

<template>
  <div class="flex w-full align-center justify-between">
    <H4 class="leading-loose">Passkeys</H4>

    <Button @click="addPasskey()" variant="outline" :icon="PlusIcon">
      Add passkey
    </Button>
  </div>

  <DataTable class="w-full" :columns="columns" :data="passkeys"></DataTable>
</template>
