FROM mcr.microsoft.com/playwright:v1.57.0-jammy

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install ONLY production dependencies
RUN npm install --production

# Copy all source files
COPY . .

# Expose port Render will detect
EXPOSE 10000

# Start server
CMD ["node", "index.js"]
