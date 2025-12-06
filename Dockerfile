# Use Playwright image that contains browsers and runtime
FROM mcr.microsoft.com/playwright:v1.57.0-jammy

WORKDIR /app

# Copy package files (cache layer)
COPY package.json package-lock.json* ./

# Install production dependencies
RUN npm ci --only=production

# Copy source
COPY . .

# Expose port (Render will detect)
EXPOSE 10000

# Start service
CMD ["node", "index.js"]
