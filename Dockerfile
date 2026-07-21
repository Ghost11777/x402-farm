FROM mcr.microsoft.com/playwright:v1.50.0-noble
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
ENV PORT=3402
EXPOSE 3402
CMD ["node", "src/index.js"]
