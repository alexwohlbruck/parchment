# Parchment Maps
A modern mapping and navigation app based on open data and open source.


## Setup

1. Enable execution of the `start.sh` script:
  ```sh
  chmod +x start.sh
  ```
2. Run the start script with the `--seed` flag:
```sh
./start.sh --seed
```
3. After a few moments, you will be prompted to enter your user details. Use your real email address, this will be used to sign in.
```sh
Migration finished
Seeding the database...
Enter first name: Alex
Enter last name: Wohlbruck
Enter email: email@example.com
Enter picture URL: https://github.com/alexwohlbruck.png
✅ Inserted 5 permissions
✅ Inserted 3 roles
✅ Assigned 0 permissions to role user
✅ Assigned 4 permissions to role alpha
✅ Assigned all 5 permissions to role admin
Seed finished
App started.
```

## Run the app

1. Run the script:
  ```**sh**
  ./start.sh [--prod] [--migrate] [--seed]
  ```
  Flags:
  - `--prod`: Run in production mode
  - `--migrate`: Run migrations
  - `--seed`: Run migrations and seed the database. Use if running for the first time.
  
2. Open the app in your browser: [http://localhost:5173](http://localhost:5173)

## Build for production

#### TODO
