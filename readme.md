# Parchment Maps
A modern mapping and navigation app based on open data and open source.

## Requirements

- [Docker](https://www.docker.com/)

## Setup

1. Inside the `server` directory, create an `.env.local` file and fill in the required environment variables:

```sh
cd server
touch .env.local
```

|Name                 |Description                                                |
|---------------------|-----------------------------------------------------------|
|SERVER_ORIGIN        |Base URL of the backend server                             |
|CLIENT_ORIGIN        |Base URL of the frontend server                            |
|DATABASE_URL         |Connection string for local development Postgres DB        |
|GMAIL_EMAIL          |Your Gmail email address                                   |
|GMAIL_APP_PASSWORD   |Your Gmail app password for sending emails from the server |

2. Inside the `web` directory, create an `.env.local` file and fill in the required environment variables:

```sh
cd ../web
touch .env.local
```

|Name                        |Description                                           |
|----------------------------|------------------------------------------------------|
|VITE_SERVER_ORIGIN          | The server base URL, typically http://localhost:5000
|VITE_MAPBOX_ACCESS_TOKEN    | Your Mapbox access token
|VITE_TRANSITLAND_API_KEY    | Your Transitland API key
|VITE_MAPTILER_API_KEY       | Your Maptiler API key


3. Back in the root directroy, enable execution of the `start.sh` script:
```sh
chmod +x start.sh
```
4. Run the start script with the `--seed` flag:
```sh
./start.sh --seed
```
5. After a few moments, you will be prompted to enter your user details. Use your real email address, this will be used to sign in.
```sh
Migration finished
Seeding the database...
Enter first name: John
Enter last name: Doe
Enter email: email@example.com
Enter picture URL: https://github.com/john-doe.png
✅ Inserted 5 permissions
✅ Inserted 3 roles
✅ Assigned 0 permissions to role user
✅ Assigned 4 permissions to role alpha
✅ Assigned all 5 permissions to role admin
✅ Inserted user John Doe
✅ Assigned admin role to John Doe
Seed finished
App started, running on http://localhost:5173
```

## Run the app

1. Run the script:
  ```sh
  ./start.sh [--prod] [--migrate] [--seed]
  ```
  Flags:
  - `--prod`: Run in production mode
  - `--migrate`: Run migrations
  - `--seed`: Run migrations and seed the database. Use if running for the first time.
  
2. Open the app in your browser: [http://localhost:5173](http://localhost:5173)

## Build for production

#### TODO
