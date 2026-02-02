import { IntegrationId } from '../../types/integration.types'
import { Integration } from '../../types/integration.types'
import { GoogleMapsIntegration } from './google-maps-integration'
import { PeliasIntegration } from './pelias-integration'
import { NominatimIntegration } from './nominatim-integration'
import { OverpassIntegration } from './overpass-integration'
import { MapboxIntegration } from './mapbox-integration'
import { ValhallaIntegration } from './valhalla-integration'
import { GraphHopperIntegration } from './graphhopper-integration'
import { MapillaryIntegration } from './mapillary-integration'
import { TransitlandIntegration } from './transitland-integration'
import { GeoapifyIntegration } from './geoapify-integration'
import { WikidataIntegration } from './wikidata-integration'
import { WikipediaIntegration } from './wikipedia-integration'
import { WikimediaIntegration } from './wikimedia-integration'

/**
 * Registry for all integrations
 */
export class IntegrationRegistry {
  private integrations: Map<IntegrationId, Integration<any>> = new Map()

  constructor() {
    this.registerDefaultIntegrations()
  }

  /**
   * Register all default integrations
   */
  private registerDefaultIntegrations(): void {
    this.registerIntegration(new GoogleMapsIntegration())
    this.registerIntegration(new PeliasIntegration())
    this.registerIntegration(new NominatimIntegration())
    this.registerIntegration(new OverpassIntegration())
    this.registerIntegration(new MapboxIntegration())
    this.registerIntegration(new ValhallaIntegration())
    this.registerIntegration(new GraphHopperIntegration())
    this.registerIntegration(new MapillaryIntegration())
    this.registerIntegration(new TransitlandIntegration())
    this.registerIntegration(new GeoapifyIntegration())
    this.registerIntegration(new WikidataIntegration())
    this.registerIntegration(new WikipediaIntegration())
    this.registerIntegration(new WikimediaIntegration())
  }

  /**
   * Register a new integration
   * @param integration The integration to register
   */
  registerIntegration(integration: Integration<any>): void {
    this.integrations.set(integration.integrationId, integration)
  }

  /**
   * Get an integration by its integration ID
   * @param integrationId The integration ID
   * @returns The integration instance, or undefined if not found
   */
  getIntegration(integrationId: IntegrationId): Integration<any> | undefined {
    return this.integrations.get(integrationId)
  }
}
