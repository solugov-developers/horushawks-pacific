FROM mcr.microsoft.com/playwright:v1.57.0-jammy

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY backend.js ./

EXPOSE 4000
CMD ["node", "backend.js"]
