# Parchment Web Client
Front-end web client for the Parchment Maps application.

## Setup
### Recommended software
- [Bun](https://bun.sh)
- [Vite](https://vitejs.dev)
- [VS Code](https://code.visualstudio.com/) + [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar) (and disable Vetur) + [TypeScript Vue Plugin (Volar)](https://marketplace.visualstudio.com/items?itemName=Vue.vscode-typescript-vue-plugin).

### Steps
1. Install packages
  `bun i`
2. Environment variables setup
  1. Create `.env.local` file inside root directory
  2. Add the required environment variables listed below
   
### Environment variables
These are env variables that are required to run the app. These are subject to change as development progresses.
`VITE_MAPBOX_ACCESS_TOKEN`: Access token obtained from Mapbox developer portal.
`VITE_TRANSITLAND_API_KEY`: API key obtained from Transitland developer portal.
`VITE_MAPTILER_API_KEY`: API key obtained from Maptiler developer portal.

## Development
1. Run development server
  `bun dev`

## Building for production
1. Run build script
  `bun run build`