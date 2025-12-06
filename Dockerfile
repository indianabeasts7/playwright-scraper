FROM mcr.microsoft.com/playwright:v1.57.0-jammy

WORKDIR /app

# Copy only package files first (caches install)
COPY package.json package-lock.json* ./

# Install clean production dependencies
RUN npm install --production

# Copy source code last
COPY . .

EXPOSE 10000

CMD ["node", "index.js"]
