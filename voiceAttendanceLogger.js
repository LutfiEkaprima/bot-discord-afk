const fs = require('fs');
const path = require('path');
const { getVoiceConnection } = require('@discordjs/voice');

const DATA_DIR = path.join(__dirname, 'data');
const LOG_FILE = path.join(DATA_DIR, 'voice-attendance.log');

// Cuma dicatat ke console (kebaca lewat `docker logs`) + file lokal, sengaja
// tidak dikirim ke Discord sama sekali.
function logLine(text) {
  const line = `[${new Date().toISOString()}] ${text}`;
  console.log(line);
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, `${line}\n`);
  } catch (err) {
    console.error('Gagal menulis voice-attendance.log:', err.message);
  }
}

// Mencatat siapa join/leave voice channel yang SEDANG ditempati bot (bukan
// channel Discord manapun) — dicek langsung dari koneksi voice bot yang aktif,
// jadi selalu ikut ke mana pun bot itu sebenarnya berada saat ini.
function setupVoiceAttendanceLogger(client) {
  client.on('voiceStateUpdate', (oldState, newState) => {
    const member = newState.member ?? oldState.member;
    if (!member || member.user.bot) return;

    const guildId = newState.guild.id;
    const connection = getVoiceConnection(guildId);
    const botChannelId = connection?.joinConfig?.channelId;
    if (!botChannelId) return;

    const wasIn = oldState.channelId === botChannelId;
    const isIn = newState.channelId === botChannelId;
    if (wasIn === isIn) return;

    if (isIn) {
      logLine(`JOIN  ${member.user.tag} (${member.id}) -> "${newState.channel?.name}" [guild ${guildId}]`);
    } else {
      logLine(`LEAVE ${member.user.tag} (${member.id}) <- "${oldState.channel?.name}" [guild ${guildId}]`);
    }
  });
}

module.exports = { setupVoiceAttendanceLogger };
