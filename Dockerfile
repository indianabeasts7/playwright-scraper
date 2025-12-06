# Dockerfile - Playwright base (browsers included)
FROM mcr.microsoft.com/playwright:v1.57.0-jammy

WORKDIR /app

# Copy package manifests and install
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copy app
COPY . .

# Data directory (persist via volume if you want)
RUN mkdir -p /app/data

EXPOSE 10000

CMD ["node", "index.js"]
