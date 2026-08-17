FROM node:22-alpine

# Chromium headless dipakai buat deteksi live TikTok (lewat playwright-core),
# karena status live-nya cuma muncul setelah JavaScript TikTok jalan di browser.
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont \
  && ln -sf "$(command -v chromium-browser || command -v chromium)" /usr/bin/bot-chromium
ENV CHROMIUM_EXECUTABLE_PATH=/usr/bin/bot-chromium

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.js activityLogger.js liveMonitor.js ./

CMD ["node", "index.js"]
