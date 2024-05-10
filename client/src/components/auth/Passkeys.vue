<script setup lang="ts">
import { onMounted, ref } from 'vue'
import dayjs from 'dayjs'
import localizedFormat from 'dayjs/plugin/localizedFormat'
import { Button } from '@/components/ui/button'
import { useAuthService } from '@/services/auth.service'
import DataTable from '@/components/table/DataTable.vue'

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
  <Button @click="addPasskey()" variant="outline">Add passkey</Button>

  <DataTable class="w-full" :columns="columns" :data="passkeys"></DataTable>
</template>
