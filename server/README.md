# Parchment Web Server
Web server and API for the Parchment Maps application.

## Setup
### Recommended software
- [Bun](https://bun.sh)
- [VS Code](https://code.visualstudio.com/) + [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar) (and disable Vetur) + [TypeScript Vue Plugin (Volar)](https://marketplace.visualstudio.com/items?itemName=Vue.vscode-typescript-vue-plugin).

### Steps
1. Install packages
   `bun i`
2. Environment variables setup
   1. Create `.env.local` file inside root directory
   2. Add the required environment variables listed below
   
### Environment variables
These are env variables that are required to run the app. These are subject to change as development progresses.
`SERVER_ORIGIN`: Base URL of the backend server
`CLIENT_ORIGIN`: Base URL of the frontend server
`DATABASE_URL_NEON`: Connection string for production Neon DB
`DATABASE_URL_LOCAL`: Connection string for local development Postgres DB
`GMAIL_EMAIL`: Your Gmail email address
`GMAIL_APP_PASSWORD`: Your Gmail app password, for sending emails from the server

## Development
1. Run development server
  `bun dev`
