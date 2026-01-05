# ---------- BUILD STAGE ----------
    FROM node:lts-alpine AS builder
    WORKDIR /app
    
    # Install deps
    COPY package*.json ./
    RUN npm ci
    
    # Copy source
    COPY . .
    
    # Build Next.js
    RUN npm run build
    
    
    # ---------- RUNTIME STAGE ----------
    FROM node:lts-alpine
    WORKDIR /app
    
    ENV NODE_ENV=production
    
    # Copy only what we need
    COPY --from=builder /app/package*.json ./
    COPY --from=builder /app/node_modules ./node_modules
    COPY --from=builder /app/.next ./.next
    COPY --from=builder /app/public ./public
    
    # Cloud Run / ECS standard
    EXPOSE 8080
    
    CMD ["npm", "start"]
    