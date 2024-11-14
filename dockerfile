# Multi-stage Dockerfile
# Stage 1: Build Frontend (Vue)
FROM oven/bun:latest AS frontend-build
WORKDIR /client
COPY ./client ./
RUN bun install && bun run build

# Stage 2: Build Backend (Elysia with Bun)
FROM oven/bun:latest AS backend-build
WORKDIR /server
COPY ./server ./
RUN bun install --production

# Stage 3: Final Build (Base Image)
FROM ubuntu:22.04

# Install dependencies
RUN apt-get update && apt-get install -y \
    curl \
    openjdk-11-jre-headless \
    postgresql postgis \
    && rm -rf /var/lib/apt/lists/*

# Install OpenSearch
RUN curl https://artifacts.opensearch.org/releases/bundle/opensearch/2.10.0/opensearch-2.10.0-linux-x64.tar.gz | tar -xz && \
    mv opensearch-2.10.0 /usr/share/opensearch && \
    chown -R 1000:1000 /usr/share/opensearch

# Copy frontend build
COPY --from=frontend-build /client/dist /var/www/frontend

# Copy backend build
COPY --from=backend-build /server /app/server

# Copy Pelias configuration files
COPY ./pelias /etc/pelias

# Add necessary scripts for launching the services
COPY ./entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Expose ports for the services
EXPOSE 5173 5000 9200 4000 8989 3000

# Entry point script that starts all services
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
