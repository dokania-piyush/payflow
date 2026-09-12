FROM node:20-alpine AS frontend-build

WORKDIR /frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend ./
RUN npm run build

FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY src ./src
COPY public ./public
COPY --from=frontend-build /frontend/dist ./public

EXPOSE 3000

CMD ["node", "src/app.js"]
