#!/bin/bash
export DOCKERFILE=Dockerfile.dev
export NODE_ENV=development
docker-compose up --build backend server-db