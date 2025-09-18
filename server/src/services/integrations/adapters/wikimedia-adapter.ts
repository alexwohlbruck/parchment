import type { PlacePhoto } from '../../../types/place.types'
import { SOURCE } from '../../../lib/constants'

/**
 * Interface for Wikimedia Commons image data
 */
export interface WikimediaImageInfo {
  url: string
  thumburl?: string
  width: number
  height: number
  size: number
  mime: string
  extmetadata?: {
    DateTime?: { value: string }
    Artist?: { value: string }
    License?: { value: string }
    LicenseShortName?: { value: string }
    UsageTerms?: { value: string }
    AttributionRequired?: { value: string }
    Restrictions?: { value: string }
    ImageDescription?: { value: string }
    Categories?: { value: string }
  }
}

export interface WikimediaPageData {
  pageid: number
  title: string
  imageinfo: WikimediaImageInfo[]
}

/**
 * Adapter for transforming Wikimedia Commons API data to unified formats
 */
export class WikimediaAdapter {
  /**
   * Adapt Wikimedia Commons image data to PlacePhoto format
   */
  adaptImageData(page: WikimediaPageData, imageInfo: WikimediaImageInfo): PlacePhoto {
    const fileName = page.title.replace(/^File:/, '')
    
    return {
      url: imageInfo.thumburl || imageInfo.url,
      sourceId: SOURCE.WIKIMEDIA,
      width: imageInfo.width,
      height: imageInfo.height,
      alt: this.extractImageDescription(imageInfo) || fileName,
      isPrimary: false, // Will be set by the calling code if needed
      metadata: this.extractImageMetadata(imageInfo),
    }
  }

  /**
   * Extract image description from metadata
   */
  private extractImageDescription(imageInfo: WikimediaImageInfo): string | null {
    if (!imageInfo.extmetadata) return null

    const description = imageInfo.extmetadata.ImageDescription?.value
    if (!description) return null

    // Clean up HTML and wiki markup from description
    return description
      .replace(/<[^>]+>/g, '') // Remove HTML tags
      .replace(/\[\[([^|\]]+)\|?[^\]]*\]\]/g, '$1') // Convert wiki links to plain text
      .replace(/\{\{[^}]+\}\}/g, '') // Remove templates
      .trim()
  }

  /**
   * Extract useful metadata from image info
   */
  private extractImageMetadata(imageInfo: WikimediaImageInfo): Record<string, string> {
    const metadata: Record<string, string> = {}

    if (!imageInfo.extmetadata) return metadata

    const extMeta = imageInfo.extmetadata

    // Extract license information
    if (extMeta.License?.value) {
      metadata.license = extMeta.License.value
    }
    if (extMeta.LicenseShortName?.value) {
      metadata.licenseShort = extMeta.LicenseShortName.value
    }
    if (extMeta.UsageTerms?.value) {
      metadata.usageTerms = extMeta.UsageTerms.value
    }

    // Extract attribution information
    if (extMeta.Artist?.value) {
      metadata.artist = this.cleanHtmlFromMetadata(extMeta.Artist.value)
    }
    if (extMeta.AttributionRequired?.value) {
      metadata.attributionRequired = extMeta.AttributionRequired.value
    }

    // Extract date
    if (extMeta.DateTime?.value) {
      metadata.dateTime = extMeta.DateTime.value
    }

    // Extract restrictions
    if (extMeta.Restrictions?.value) {
      metadata.restrictions = extMeta.Restrictions.value
    }

    // Extract categories
    if (extMeta.Categories?.value) {
      metadata.categories = extMeta.Categories.value
    }

    return metadata
  }

  /**
   * Clean HTML and wiki markup from metadata values
   */
  private cleanHtmlFromMetadata(value: string): string {
    return value
      .replace(/<[^>]+>/g, '') // Remove HTML tags
      .replace(/\[\[([^|\]]+)\|?[^\]]*\]\]/g, '$1') // Convert wiki links to plain text
      .replace(/\{\{[^}]+\}\}/g, '') // Remove templates
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .trim()
  }

  /**
   * Determine if an image is suitable for use as a place photo
   * Filters out low-quality, inappropriate, or non-photographic images
   */
  isImageSuitableForPlace(imageInfo: WikimediaImageInfo): boolean {
    // Check minimum dimensions
    if (imageInfo.width < 300 || imageInfo.height < 200) {
      return false
    }

    // Check file size (avoid tiny files)
    if (imageInfo.size < 10000) { // 10KB minimum
      return false
    }

    // Check MIME type - prefer photos over diagrams/drawings
    const preferredMimes = ['image/jpeg', 'image/png', 'image/webp']
    if (!preferredMimes.includes(imageInfo.mime)) {
      return false
    }

    // Check for problematic categories in metadata
    if (imageInfo.extmetadata?.Categories?.value) {
      const categories = imageInfo.extmetadata.Categories.value.toLowerCase()
      const problematicTerms = [
        'diagram', 'chart', 'graph', 'map', 'drawing', 'illustration',
        'logo', 'symbol', 'icon', 'flag', 'coat of arms'
      ]
      
      if (problematicTerms.some(term => categories.includes(term))) {
        return false
      }
    }

    return true
  }

  /**
   * Sort images by quality and relevance
   * Higher scores indicate better images for place representation
   */
  scoreImageForPlace(imageInfo: WikimediaImageInfo, fileName: string): number {
    let score = 0

    // Base score from dimensions (prefer larger images)
    const pixelCount = imageInfo.width * imageInfo.height
    score += Math.min(pixelCount / 1000000, 10) // Max 10 points for size

    // Prefer landscape orientation for most places
    const aspectRatio = imageInfo.width / imageInfo.height
    if (aspectRatio >= 1.2 && aspectRatio <= 2.0) {
      score += 2
    }

    // Prefer JPEG (usually photos) over PNG (often graphics)
    if (imageInfo.mime === 'image/jpeg') {
      score += 2
    }

    // Boost score for professional-looking file names
    const cleanFileName = fileName.toLowerCase()
    if (cleanFileName.includes('exterior') || cleanFileName.includes('facade')) {
      score += 3
    }
    if (cleanFileName.includes('interior') || cleanFileName.includes('inside')) {
      score += 2
    }
    if (cleanFileName.includes('panorama') || cleanFileName.includes('view')) {
      score += 2
    }

    // Penalize generic or poor quality indicators
    const badTerms = ['thumb', 'icon', 'small', 'tiny', 'crop']
    if (badTerms.some(term => cleanFileName.includes(term))) {
      score -= 2
    }

    return score
  }
}
