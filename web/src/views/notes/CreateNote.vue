<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useNotesService } from '@/services/notes.service'
import { useMapService } from '@/services/map.service'
import { useAppService } from '@/services/app.service'
import { LngLat } from '@/types/map.types'
import { AppRoute } from '@/router'
import CreateNoteMarker from '@/components/map/CreateNoteMarker.vue'
import CreateNotePanel from '@/components/notes/CreateNotePanel.vue'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const notesService = useNotesService()
const { flyTo, addVueMarker, removeMarker } = useMapService()
const { toast } = useAppService()

const MARKER_ID = 'create-note-marker'

const lat = ref(Number(route.query.lat))
const lng = ref(Number(route.query.lng))
const isSubmitting = ref(false)

onMounted(() => {
  placeMarker()
  flyTo({ center: [lng.value, lat.value] })
})

onUnmounted(() => {
  removeMarker(MARKER_ID)
})

function placeMarker() {
  removeMarker(MARKER_ID)
  addVueMarker(
    MARKER_ID,
    { lng: lng.value, lat: lat.value },
    CreateNoteMarker,
    {},
    undefined,
    {
      onDragEnd: (lngLat: LngLat) => {
        lat.value = lngLat.lat
        lng.value = lngLat.lng
      },
    },
  )
}

async function handleSubmit(text: string) {
  isSubmitting.value = true
  try {
    const note = await notesService.createNote(lat.value, lng.value, text)
    toast.success(t('notes.noteCreated'))
    // Refresh notes layer markers
    await notesService.refreshNotes()
    router.replace({ name: AppRoute.NOTE, params: { id: String(note.id) } })
  } catch (error) {
    toast.error(t('notes.createError'))
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <CreateNotePanel
    :lat="lat"
    :lng="lng"
    :is-submitting="isSubmitting"
    @close="router.push({ name: AppRoute.MAP })"
    @submit="handleSubmit"
  />
</template>
