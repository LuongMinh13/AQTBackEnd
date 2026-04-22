# syntax=docker/dockerfile:1
# Image unique Node + Python : build du frontend Vite puis lance le backend
# Express qui sert l'API ET le dist/ en statique.

FROM node:20-slim

# --- Python + outils système ---
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 \
      python3-pip \
      python3-venv \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# --- Dépendances Python (pdfplumber, pandas, openpyxl) ---
COPY backend/requirements.txt backend/requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages -r backend/requirements.txt

# --- Dépendances frontend (cache-friendly) ---
COPY package.json package-lock.json ./
RUN npm ci

# --- Dépendances backend (cache-friendly) ---
COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci --omit=dev

# --- Code source ---
COPY . .

# --- Build du frontend (génère dist/) ---
RUN npm run build

ENV NODE_ENV=production
ENV PYTHON_BIN=python3
ENV PORT=3001

EXPOSE 3001

CMD ["node", "backend/server.js"]
