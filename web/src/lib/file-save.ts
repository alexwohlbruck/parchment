/**
 * Hand a generated file to the user: the share sheet on a touch device, where
 * a download lands somewhere nobody looks, and a plain download elsewhere.
 */
const isTouch = () => !!window.matchMedia?.('(pointer: coarse)').matches

/**
 * Whether saving this file now would open a share sheet the browser refuses,
 * because the tap that started the work has expired.
 */
export function saveNeedsTap(blob: Blob, filename: string): boolean {
  const file = new File([blob], filename, { type: blob.type })
  const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation
  return isTouch() && !!navigator.canShare?.({ files: [file] }) && activation?.isActive === false
}

export async function saveFile(blob: Blob, filename: string): Promise<void> {
  const file = new File([blob], filename, { type: blob.type })
  if (isTouch() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return
    } catch (error) {
      if ((error as DOMException).name === 'AbortError') return
    }
  }

  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
