# --- Build Stage ---
FROM node:20 AS builder

WORKDIR /app

# Install dependencies first for better caching
COPY package*.json ./
RUN npm install

# Copy source and build the frontend
COPY . .
RUN npm run build

# Prune dev dependencies in the builder so only production node_modules
# are copied to the final image (preserves better-sqlite3 native binary)
RUN npm prune --production

# --- Production Stage ---
FROM node:20-slim

WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000
ENV CONFIG_DIR=/app/data
ENV LOCAL_URL=http://localhost:11434
ENV CLOUD_URL=
ENV ROUTER_MODEL=
ENV ROUTER_URL=

# Copy built assets from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/*.ts ./

# Copy already-pruned node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Create data directory for persistence
RUN mkdir -p /app/data && \
    npm install -g tsx

EXPOSE 3000

# Start the server
CMD ["tsx", "server.ts"]
