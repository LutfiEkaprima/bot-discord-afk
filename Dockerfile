FROM node:22-alpine

# yt-dlp + ffmpeg dipakai fitur !play buat narik & transcode audio dari YouTube.
# yt-dlp diinstall lewat pip (bukan `apk add yt-dlp`) supaya dapat rilis
# terbaru dari PyPI saat build — yt-dlp perlu sering di-update mengikuti
# perubahan YouTube, dan paket di repo Alpine biasanya ketinggalan.
RUN apk add --no-cache python3 py3-pip ffmpeg \
  && pip3 install --no-cache-dir --break-system-packages yt-dlp

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.js activityLogger.js musicPlayer.js ./

CMD ["node", "index.js"]
