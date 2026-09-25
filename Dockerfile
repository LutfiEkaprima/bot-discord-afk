FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.js activityLogger.js voiceAttendanceLogger.js afkConfig.js ./

CMD ["node", "index.js"]
