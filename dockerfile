# ---------- BUILD STAGE ----------
FROM node:lts-alpine AS builder
WORKDIR /app

# Install deps
COPY package*.json ./
RUN npm ci

# Copy source
COPY . .

# Build Next.js with environment variables
# Note: NEXT_PUBLIC_* variables must be available at build time
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ARG NEXT_PUBLIC_FIREBASE_APP_ID
ARG NEXT_PUBLIC_APP_URL

ENV NEXT_PUBLIC_FIREBASE_API_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY
ENV NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ENV NEXT_PUBLIC_FIREBASE_PROJECT_ID=$NEXT_PUBLIC_FIREBASE_PROJECT_ID
ENV NEXT_PUBLIC_FIREBASE_APP_ID=$NEXT_PUBLIC_FIREBASE_APP_ID
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL

# Build Next.js
RUN npm run build

# ---------- RUNTIME STAGE ----------
FROM node:lts-alpine
WORKDIR /app

ENV NODE_ENV=production
# Cloud Run sets PORT automatically, but default to 8080
ENV PORT=8080

# Create non-root user (handle case where group/user might already exist)
# Get or create group with GID 1000, then create user with UID 1000
RUN GROUP_NAME=$(getent group 1000 | cut -d: -f1) || GROUP_NAME="nodejs"; \
    if [ -z "$GROUP_NAME" ] || [ "$GROUP_NAME" = "" ]; then \
        addgroup -g 1000 -S nodejs && GROUP_NAME="nodejs"; \
    fi; \
    adduser -S nextjs -u 1000 2>/dev/null || true; \
    adduser nextjs $GROUP_NAME 2>/dev/null || true

# Copy only what we need (using numeric IDs for reliability)
COPY --from=builder --chown=1000:1000 /app/package*.json ./
COPY --from=builder --chown=1000:1000 /app/node_modules ./node_modules
COPY --from=builder --chown=1000:1000 /app/.next ./.next
COPY --from=builder --chown=1000:1000 /app/public ./public

# Switch to non-root user (using numeric UID for reliability)
USER 1000

# Cloud Run / ECS standard
EXPOSE 8080

# Use PORT environment variable (Cloud Run sets this automatically)
CMD ["sh", "-c", "npm start"]