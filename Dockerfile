FROM mcr.microsoft.com/playwright:v1.57.0-jammy

WORKDIR /app

# Copy package files only first (for caching)
COPY package.json package-lock.json* ./

# Install only production dependencies
RUN npm install --production

# Copy the rest of your source code
COPY . .

# Render auto-detects the port, but we expose it anyway
EXPOSE 10000

# Start your scraper server
CMD ["node", "index.js"]
