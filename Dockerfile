FROM node:20-alpine
RUN apk add --no-cache openssl

WORKDIR /app

# Install ALL dependencies. The production build needs devDependencies
# (cross-env, @react-router/dev, vite, the prisma CLI), so we must NOT set
# NODE_ENV=production or --omit=dev before building.
COPY package.json package-lock.json* ./
RUN npm ci && npm cache clean --force

COPY . .

# Generate the production PostgreSQL Prisma client before bundling.
# Prisma validates the datasource URL while generating the client. This is a
# non-secret build-only default; Compose replaces it with DATABASE_URL at runtime.
ARG DATABASE_URL=postgresql://skuforge:build-only@localhost:5432/skuforge
ENV DATABASE_URL=${DATABASE_URL}
RUN npm run generate:postgres

RUN npm run build

# Runtime configuration. docker-start runs `prisma migrate deploy` (needs the
# prisma CLI, kept above) then serves the built app.
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "run", "docker-start"]
