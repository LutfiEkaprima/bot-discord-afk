const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'afk-channels.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return {};
  }
}

const afkChannels = load();

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(afkChannels, null, 2));
}

function setAfkChannel(guildId, channelId) {
  afkChannels[guildId] = channelId;
  save();
}

function clearAfkChannel(guildId) {
  delete afkChannels[guildId];
  save();
}

function getAllAfkChannels() {
  return { ...afkChannels };
}

module.exports = { setAfkChannel, clearAfkChannel, getAllAfkChannels };
