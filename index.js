require('dotenv').config();
const { Client, GatewayIntentBits, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const {
  joinVoiceChannel,
  getVoiceConnection,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');
const { setupActivityLogger } = require('./activityLogger');
const {
  startLiveMonitor,
  addYoutube,
  removeYoutube,
  listYoutube,
  addTiktok,
  removeTiktok,
  listTiktok,
} = require('./liveMonitor');

const PREFIX = process.env.PREFIX || '!';
const RECONNECT_DELAY_MS = 5_000;

// Command "leave" sengaja tidak dimasukkan ke !help.
const HELP_ENTRIES = [
  {
    usage: 'join',
    description: 'Bot ikut masuk ke voice channel yang sedang kamu tempati dan tetap di sana (self-mute + self-deaf).',
    notes: 'Kamu harus sudah berada di sebuah voice channel dulu sebelum pakai command ini.',
    example: '!join',
  },
  {
    usage: 'ytadd <channel_id / @handle / url> [label]',
    description: 'Tambah channel YouTube ke pemantauan live. Kalau channel-nya live, notifikasi + link stream otomatis dikirim ke channel LIVE_CHANNEL_ID.',
    notes: 'Butuh izin **Manage Server**. `<...>` wajib diisi, `[label]` opsional (nama tampilan di notifikasi, boleh lebih dari satu kata).',
    example: '!ytadd @lofigirl Lofi Girl',
  },
  {
    usage: 'ytremove <channel_id / @handle / url>',
    description: 'Hapus channel YouTube dari pemantauan.',
    notes: 'Butuh izin **Manage Server**. Isi persis seperti saat `!ytadd` (handle/ID/url yang sama).',
    example: '!ytremove @lofigirl',
  },
  {
    usage: 'ytlist',
    description: 'Lihat daftar channel YouTube yang sedang dipantau, beserta status live-nya sekarang.',
    notes: 'Bisa dipakai siapa saja, tidak butuh izin khusus.',
    example: '!ytlist',
  },
  {
    usage: 'ttadd <username / url> [label]',
    description: 'Tambah akun TikTok ke pemantauan live. Kalau akunnya live, notifikasi + link stream otomatis dikirim ke channel LIVE_CHANNEL_ID.',
    notes: 'Butuh izin **Manage Server**. `<...>` wajib diisi, `[label]` opsional.',
    example: '!ttadd poung770',
  },
  {
    usage: 'ttremove <username / url>',
    description: 'Hapus akun TikTok dari pemantauan.',
    notes: 'Butuh izin **Manage Server**. Isi persis seperti saat `!ttadd` (username/url yang sama).',
    example: '!ttremove poung770',
  },
  {
    usage: 'ttlist',
    description: 'Lihat daftar akun TikTok yang sedang dipantau, beserta status live-nya sekarang.',
    notes: 'Bisa dipakai siapa saja, tidak butuh izin khusus.',
    example: '!ttlist',
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
startLiveMonitor(client);

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
    return message.reply(`Bergabung ke voice channel **${voiceChannel.name}**.`);
  }

  if (command === 'leavebylutfi') {
    const connection = getVoiceConnection(message.guild.id);
    if (!connection) {
      return message.reply('Bot sedang tidak berada di voice channel manapun.');
    }
    connection.destroy();
    return message.reply('Keluar dari voice channel.');
  }

  const canManageWatchlist = () => message.member?.permissions?.has(PermissionFlagsBits.ManageGuild);

  if (command === 'ytadd') {
    if (!canManageWatchlist()) return message.reply('Butuh izin **Manage Server** untuk pakai command ini.');
    if (!args[0]) return message.reply('Pakai: `!ytadd <channel_id / @handle / url> [label]`');

    const [target, ...labelParts] = args;
    const { added } = addYoutube(target, labelParts.join(' '));
    return message.reply(
      added ? `Channel YouTube **${target}** ditambahkan ke pemantauan.` : `Channel **${target}** sudah ada di daftar pantau.`,
    );
  }

  if (command === 'ytremove') {
    if (!canManageWatchlist()) return message.reply('Butuh izin **Manage Server** untuk pakai command ini.');
    if (!args[0]) return message.reply('Pakai: `!ytremove <channel_id / @handle / url>`');

    const removed = removeYoutube(args[0]);
    return message.reply(removed ? `Channel **${args[0]}** dihapus dari pemantauan.` : `Channel **${args[0]}** tidak ditemukan di daftar pantau.`);
  }

  if (command === 'ytlist') {
    const entries = listYoutube();
    if (entries.length === 0) return message.reply('Belum ada channel YouTube yang dipantau.');
    const lines = entries.map((e) => `- **${e.label}** (${e.key}) ${e.isLive ? '🔴 sedang live' : ''}`);
    return message.reply(lines.join('\n'));
  }

  if (command === 'ttadd') {
    if (!canManageWatchlist()) return message.reply('Butuh izin **Manage Server** untuk pakai command ini.');
    if (!args[0]) return message.reply('Pakai: `!ttadd <username / url> [label]`');

    const [target, ...labelParts] = args;
    const { added } = addTiktok(target, labelParts.join(' '));
    return message.reply(
      added ? `Akun TikTok **${target}** ditambahkan ke pemantauan.` : `Akun **${target}** sudah ada di daftar pantau.`,
    );
  }

  if (command === 'ttremove') {
    if (!canManageWatchlist()) return message.reply('Butuh izin **Manage Server** untuk pakai command ini.');
    if (!args[0]) return message.reply('Pakai: `!ttremove <username / url>`');

    const removed = removeTiktok(args[0]);
    return message.reply(removed ? `Akun **${args[0]}** dihapus dari pemantauan.` : `Akun **${args[0]}** tidak ditemukan di daftar pantau.`);
  }

  if (command === 'ttlist') {
    const entries = listTiktok();
    if (entries.length === 0) return message.reply('Belum ada akun TikTok yang dipantau.');
    const lines = entries.map((e) => `- **${e.label}** (@${e.username}) ${e.isLive ? '🔴 sedang live' : ''}`);
    return message.reply(lines.join('\n'));
  }
});

client.login(process.env.TOKEN);
