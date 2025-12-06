FROM mcr.microsoft.com/playwright:v1.57.0-focal

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production

COPY . .

EXPOSE 10000

CMD ["node", "index.js"]
