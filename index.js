require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const {
  joinVoiceChannel,
  getVoiceConnection,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');

const PREFIX = process.env.PREFIX || '!';
const RECONNECT_DELAY_MS = 5_000;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

function connectToChannel(channel) {
  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: true,
    selfMute: true,
  });

  // Discord can drop the voice connection (network hiccup, being moved, etc).
  // Try to tell a real disconnect apart from a brief resume, then rejoin the same channel.
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, RECONNECT_DELAY_MS),
        entersState(connection, VoiceConnectionStatus.Connecting, RECONNECT_DELAY_MS),
      ]);
      // Reconnecting on its own, nothing to do.
    } catch {
      connection.destroy();
      setTimeout(() => {
        const freshChannel = client.channels.cache.get(channel.id);
        if (freshChannel) connectToChannel(freshChannel);
      }, RECONNECT_DELAY_MS);
    }
  });

  connection.on('error', (error) => {
    console.error('Voice connection error:', error);
  });

  return connection;
}

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;
  if (!message.content.startsWith(PREFIX)) return;

  const command = message.content.slice(PREFIX.length).trim().toLowerCase();

  if (command === 'join') {
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
      return message.reply('Masuk ke voice channel dulu sebelum pakai command ini.');
    }

    const permissions = voiceChannel.permissionsFor(message.guild.members.me);
    if (!permissions?.has('Connect')) {
      return message.reply('Bot tidak punya izin **Connect** ke voice channel itu.');
    }

    connectToChannel(voiceChannel);
    return message.reply(`Bergabung ke voice channel **${voiceChannel.name}**.`);
  }

  if (command === 'leave') {
    const connection = getVoiceConnection(message.guild.id);
    if (!connection) {
      return message.reply('Bot sedang tidak berada di voice channel manapun.');
    }
    connection.destroy();
    return message.reply('Keluar dari voice channel.');
  }
});

client.login(process.env.TOKEN);
