FROM mcr.microsoft.com/playwright:v1.57.0-jammy

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm install --production

# Copy project
COPY . .

# Expose port
EXPOSE 10000

# Start server
CMD ["node", "index.js"]
