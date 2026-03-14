# ---------- Builder ----------
    FROM oven/bun:1-alpine AS builder

    WORKDIR /app
    
    ARG NEXT_PUBLIC_FIREBASE_API_KEY
    ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
    ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
    ARG NEXT_PUBLIC_FIREBASE_APP_ID
    ARG NEXT_PUBLIC_APP_URL
    ARG NEXT_PUBLIC_MAPTILER_STYLE_ID
    ARG NEXT_PUBLIC_MAPTILER_API_KEY
    
    ENV NEXT_PUBLIC_FIREBASE_API_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY
    ENV NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
    ENV NEXT_PUBLIC_FIREBASE_PROJECT_ID=$NEXT_PUBLIC_FIREBASE_PROJECT_ID
    ENV NEXT_PUBLIC_FIREBASE_APP_ID=$NEXT_PUBLIC_FIREBASE_APP_ID
    ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
    ENV NEXT_PUBLIC_MAPTILER_STYLE_ID=$NEXT_PUBLIC_MAPTILER_STYLE_ID
    ENV NEXT_PUBLIC_MAPTILER_API_KEY=$NEXT_PUBLIC_MAPTILER_API_KEY
    
    COPY package*.json bun.lock ./
    RUN bun install --frozen-lockfile
    
    COPY . .
    
    RUN bun run build
    
    
    # ---------- Production ----------
    FROM oven/bun:1-alpine
    
    WORKDIR /app
    
    ENV NODE_ENV=production
    
    # Create a non-root user and group
    RUN addgroup --system --gid 1001 nodejs && \
        adduser --system --uid 1001 --ingroup nodejs nextjs
    
    COPY --from=builder --chown=nextjs:nodejs /app/public ./public
    COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
    COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
    
    # Switch to non-root user
    USER nextjs
    
    EXPOSE 8080
    
    CMD ["bun", "server.js"]