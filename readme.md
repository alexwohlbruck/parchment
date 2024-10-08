# Parchment Maps
A modern mapping and navigation app based on open data and open source.

## Development

### Run the server

1. Navigate to the `/server` directory and follow instructions in README.md

### Run the web client

2. Navigate to the `/client` directory and follow instructions in README.md

## Deployment for production

`docker build -t parchment`

```
docker run -d \
  -p 5173:5173 \  # Frontend exposed to the host
  -p 5000:5000 \  # Backend exposed to the host
  parchment
```