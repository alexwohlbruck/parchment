export default {
  path: '/docs',
  documentation: {
    info: {
      title: 'Parchment API Docs',
      version: '0.1', // TODO
    },
    tags: [
      { name: 'Auth', description: 'Authentication and session endpoints' },
      { name: 'Users', description: 'User and profile management' },
      { name: 'Health', description: 'Health check' },
      { name: 'Library', description: 'Libraries, collections, and bookmarks' },
      { name: 'Layers', description: 'Map layers and style management' },
      { name: 'Places', description: 'Places and points of interest' },
      { name: 'Search', description: 'Search endpoints' },
      { name: 'Geocoding', description: 'Geocoding and reverse geocoding' },
      { name: 'Trip Planning', description: 'Directions and trip planning' },
      { name: 'Location', description: 'User location and history' },
      { name: 'Friends', description: 'Friends and social features' },
      { name: 'Sharing', description: 'Sharing and invitations' },
      { name: 'Federation', description: 'Federation and external identity' },
      { name: 'Integrations', description: 'Third-party integrations' },
      { name: 'Proxy', description: 'Proxy endpoints' },
      { name: 'Weather', description: 'Weather data' },
    ],
  },
}
