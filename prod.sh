#!/bin/bash
export DOCKERFILE=Dockerfile.prod
export NODE_ENV=production
docker-compose up --build backend server-db