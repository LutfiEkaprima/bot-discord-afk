FROM node:22-alpine

# yt-dlp + ffmpeg dipakai fitur !play buat narik & transcode audio dari YouTube.
RUN apk add --no-cache yt-dlp ffmpeg

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.js activityLogger.js musicPlayer.js ./

CMD ["node", "index.js"]
