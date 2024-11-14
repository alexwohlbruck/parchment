# Parchment Maps
A modern mapping and navigation app based on open data and open source.


## Setup

1. Enable execution of the `start.sh` script:
  ```sh
  chmod +x start.sh
  ```
1. Seed the database and start the app:
```sh
./start.sh --seed
```

## Run the app

2. Run the script:
  ```sh
  ./start.sh [--prod] [--migrate] [--seed]
  ```
  Flags:
  - `--prod`: Run in production mode
  - `--migrate`: Run migrations
  - `--seed`: Run migrations and seed the database. Use if running for the first time.

## Build for production

#### TODO
