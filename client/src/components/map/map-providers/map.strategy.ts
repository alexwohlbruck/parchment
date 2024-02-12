export type MapOptions = {
  dark: boolean
}

export class MapStrategy {
  container: HTMLElement
  map: any
  options: MapOptions

  constructor(container, map: any, options?: MapOptions) {
    this.container = container
    this.map = map
    this.options = options || {
      dark: false,
    }
  }

  initialize() {}
  addDataSource() {}
  addLayer() {}
  setMapTheme(dark: boolean) {}
  setStyle(url: string) {} // TODO
  remove() {}
}
