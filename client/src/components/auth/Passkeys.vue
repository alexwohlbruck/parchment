<script setup lang="ts">
import { onMounted, ref } from 'vue'
import dayjs from 'dayjs'
import localizedFormat from 'dayjs/plugin/localizedFormat'
import { Button } from '@/components/ui/button'
import { useAuthService } from '@/services/auth.service'
import { H4 } from '@/components/ui/typography'
import DataTable from '@/components/table/DataTable.vue'
import { PlusIcon } from 'lucide-vue-next'
import { Passkey } from '@/types/auth.types'
import { ColumnDef } from '@tanstack/vue-table'

dayjs.extend(localizedFormat)

const authService = useAuthService()
const passkeys = ref<Passkey[]>([])

const columns: ColumnDef<Passkey>[] = [
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
