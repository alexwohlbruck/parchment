<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useNotesService } from '@/services/notes.service'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { useMapService } from '@/services/map.service'
import { useAppService } from '@/services/app.service'
import { MarkerIds } from '@/types/map.types'
import { LngLat } from 'mapbox-gl'
import { AppRoute } from '@/router'
import type { OsmNote } from '@/types/notes.types'
import NoteDetailPanel from '@/components/notes/NoteDetailPanel.vue'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const notesService = useNotesService()
const integrationsStore = useIntegrationsStore()
const { flyTo, addMarker, removeMarker } = useMapService()
const { toast } = useAppService()

const note = ref<OsmNote | null>(null)
const loading = ref(true)
const submittingAction = ref<'comment' | 'close' | 'reopen' | null>(null)

const isAuthenticated = computed(() => !!integrationsStore.osmProfile)

async function loadNote() {
  const noteId = Number(route.params.id)
  if (!noteId || isNaN(noteId)) return

  loading.value = true
  try {
    note.value = await notesService.fetchNote(noteId)
    if (note.value) {
      const lngLat = new LngLat(note.value.lng, note.value.lat)
      addMarker(MarkerIds.SELECTED_POI, lngLat)
      flyTo({ center: [lngLat.lng, lngLat.lat] })
    }
  } catch (error) {
    console.error('Failed to load note:', error)
  } finally {
    loading.value = false
  }
}

async function handleComment(text: string) {
  if (!note.value) return
  submittingAction.value = 'comment'
  try {
    note.value = await notesService.commentOnNote(note.value.id, text)
    toast.success(t('notes.commentAdded'))
  } catch (error) {
    toast.error(t('notes.commentError'))
  } finally {
    submittingAction.value = null
  }
}

async function handleClose(text?: string) {
  if (!note.value) return
  submittingAction.value = 'close'
  try {
    note.value = await notesService.closeNote(note.value.id, text)
    toast.success(t('notes.noteClosed'))
  } catch (error) {
    toast.error(t('notes.closeError'))
  } finally {
    submittingAction.value = null
  }
}

async function handleReopen(text?: string) {
  if (!note.value) return
  submittingAction.value = 'reopen'
  try {
    note.value = await notesService.reopenNote(note.value.id, text)
    toast.success(t('notes.noteReopened'))
  } catch (error) {
    toast.error(t('notes.reopenError'))
  } finally {
    submittingAction.value = null
  }
}

onMounted(() => {
  loadNote()
})

onUnmounted(() => {
  removeMarker(MarkerIds.SELECTED_POI)
})

watch(
  () => route.params.id,
  () => {
    removeMarker(MarkerIds.SELECTED_POI)
    loadNote()
  },
)
</script>

<template>
  <NoteDetailPanel
    :note="note"
    :loading="loading"
    :is-authenticated="isAuthenticated"
    :submitting-action="submittingAction"
    @close="router.push({ name: AppRoute.MAP })"
    @comment="handleComment"
    @close-note="handleClose"
    @reopen="handleReopen"
  />
</template>
