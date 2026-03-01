FROM node:20-alpine

WORKDIR /usr/src/app

# Install dependencies first (better layer caching)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy app source
COPY index.js ./

# Cloud Run provides PORT; default to 8080 inside container
ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "index.js"]

