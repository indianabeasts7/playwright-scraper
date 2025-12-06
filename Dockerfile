FROM mcr.microsoft.com/playwright:v1.57.0-jammy

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install only production dependencies (faster/smaller)
RUN npm install --production

# Copy the rest of the project
COPY . .

# Expose port Render should detect
EXPOSE 10000

# Start the server
CMD ["node", "index.js"]
