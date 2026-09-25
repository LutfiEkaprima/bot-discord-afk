require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const {
  joinVoiceChannel,
  getVoiceConnection,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');
const { setupActivityLogger } = require('./activityLogger');
const { setupVoiceAttendanceLogger } = require('./voiceAttendanceLogger');
const { setAfkChannel, clearAfkChannel, getAllAfkChannels } = require('./afkConfig');

const PREFIX = process.env.PREFIX || '!';
const RECONNECT_DELAY_MS = 5_000;

// Command "leave" sengaja tidak dimasukkan ke !help.
const HELP_ENTRIES = [
  {
    usage: 'join',
    description: 'Bot ikut masuk ke voice channel yang sedang kamu tempati dan tetap di sana (self-mute + self-deaf). Channel ini diingat, jadi kalau bot restart/mati, otomatis join lagi ke sini tanpa perlu !join ulang.',
    notes: 'Kamu harus sudah berada di sebuah voice channel dulu sebelum pakai command ini.',
    example: '!join',
  },
  {
    usage: 'help',
    description: 'Tampilkan daftar command ini beserta cara pakainya.',
    notes: 'Bisa dipakai siapa saja, tidak butuh izin khusus.',
    example: '!help',
  },
];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
  ],
});

setupActivityLogger(client);
setupVoiceAttendanceLogger(client);

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  for (const [guildId, channelId] of Object.entries(getAllAfkChannels())) {
    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel) throw new Error('channel tidak ditemukan');
      connectToChannel(channel);
      console.log(`Auto-join ke voice channel "${channel.name}" (guild ${guildId})`);
    } catch (err) {
      console.error(`Gagal auto-join channel ${channelId} (guild ${guildId}):`, err.message);
    }
  }
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

  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const command = args.shift()?.toLowerCase();

  if (command === 'help') {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('Daftar Command')
      .setDescription(
        `Format: \`<...>\` = wajib diisi, \`[...]\` = opsional. Prefix saat ini: \`${PREFIX}\`.`,
      )
      .addFields(
        HELP_ENTRIES.map((e) => ({
          name: `${PREFIX}${e.usage}`,
          value: `${e.description}\n${e.notes}\nContoh: \`${e.example}\``,
        })),
      );
    return message.reply({ embeds: [embed] });
  }

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
    setAfkChannel(message.guild.id, voiceChannel.id);
    return message.reply(`Bergabung ke voice channel **${voiceChannel.name}**. Channel ini akan diingat buat auto-join kalau bot restart.`);
  }

  if (command === 'leavebylutfi') {
    const connection = getVoiceConnection(message.guild.id);
    clearAfkChannel(message.guild.id);
    if (!connection) {
      return message.reply('Bot sedang tidak berada di voice channel manapun.');
    }
    connection.destroy();
    return message.reply('Keluar dari voice channel.');
  }
});

client.login(process.env.TOKEN);
