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
RUN npm run generate:postgres

RUN npm run build

# Runtime configuration. docker-start runs `prisma migrate deploy` (needs the
# prisma CLI, kept above) then serves the built app.
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "run", "docker-start"]
