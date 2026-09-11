const { spawn, execFile } = require('child_process');
const {
  createAudioPlayer,
  createAudioResource,
  joinVoiceChannel,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  StreamType,
} = require('@discordjs/voice');

const YTDLP_PATH = process.env.YTDLP_PATH || 'yt-dlp';
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
const YTDLP_COOKIES_PATH = process.env.YTDLP_COOKIES_PATH;
const YTDLP_TIMEOUT_MS = 60_000;
const IDLE_LEAVE_MS = 5 * 60 * 1000;

// YouTube sering minta "Sign in to confirm you're not a bot" buat request yang
// datang dari IP VPS/datacenter. Kalau YTDLP_COOKIES_PATH diisi (cookies.txt dari
// sesi browser yang sudah login), sisipkan ke tiap pemanggilan yt-dlp supaya
// requestnya dianggap bukan bot.
function withCookies(args) {
  return YTDLP_COOKIES_PATH ? [...args, '--cookies', YTDLP_COOKIES_PATH] : args;
}

class UserFacingError extends Error {}

const guildStates = new Map();

function getState(guildId) {
  let state = guildStates.get(guildId);
  if (!state) {
    state = {
      connection: null,
      player: null,
      queue: [],
      current: null,
      textChannel: null,
      cleanupCurrent: null,
      idleTimer: null,
    };
    guildStates.set(guildId, state);
  }
  return state;
}

function ytdlpJson(input) {
  return new Promise((resolve, reject) => {
    execFile(
      YTDLP_PATH,
      withCookies(['-j', '--no-playlist', '--no-warnings', input]),
      { maxBuffer: 10 * 1024 * 1024, timeout: YTDLP_TIMEOUT_MS },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr?.toString().trim() || err.message));
        try {
          resolve(JSON.parse(stdout));
        } catch (parseErr) {
          reject(parseErr);
        }
      },
    );
  });
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en-US,en;q=0.9' },
      signal: controller.signal,
    });
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// Spotify tidak menyediakan audio yang bisa diputar lewat API publik (DRM), jadi
// kita cuma ambil judul + artis dari meta tag halaman track-nya (tanpa perlu App
// terdaftar/API key), lalu cari lagu yang sama di YouTube buat diputar audionya.
async function resolveSpotifyTrack(url) {
  const body = await fetchText(url);
  const title = (body.match(/<meta property="og:title" content="([^"]*)"/) || [])[1];
  const description = (body.match(/<meta property="og:description" content="([^"]*)"/) || [])[1];
  if (!title) throw new UserFacingError('Gagal membaca info track dari link Spotify itu.');
  const artist = description ? description.split(' · ')[0].trim() : '';
  return [artist, title].filter(Boolean).join(' ');
}

async function resolveTrack(input) {
  const trimmed = input.trim();

  if (/open\.spotify\.com\/(album|playlist)\//i.test(trimmed)) {
    throw new UserFacingError('Link Spotify album/playlist belum didukung — pakai link 1 lagu (track) saja.');
  }
  if (/open\.spotify\.com\/track\//i.test(trimmed)) {
    const query = await resolveSpotifyTrack(trimmed);
    return ytdlpJson(`ytsearch1:${query}`);
  }
  if (/^https?:\/\/(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\//i.test(trimmed)) {
    if (/[?&]list=/i.test(trimmed) && !/(youtu\.be\/|[?&]v=)/i.test(trimmed)) {
      throw new UserFacingError('Link playlist YouTube belum didukung — pakai link 1 video saja.');
    }
    return ytdlpJson(trimmed);
  }
  throw new UserFacingError('Harus link YouTube atau Spotify (link 1 lagu), bukan teks biasa.');
}

// yt-dlp yang tarik audionya (biar deteksi format/anti-bot YouTube diurus proyek
// yang memang khusus & aktif dirawat untuk itu, bukan kita reimplement sendiri),
// dipipe ke ffmpeg buat di-transcode jadi PCM mentah yang bisa langsung dikonsumsi
// @discordjs/voice.
function createAudioStream(url) {
  const ytdlp = spawn(YTDLP_PATH, withCookies(['-f', 'bestaudio/best', '--no-playlist', '-o', '-', url]), {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const ffmpeg = spawn(
    FFMPEG_PATH,
    ['-i', 'pipe:0', '-analyzeduration', '0', '-loglevel', 'error', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );

  ytdlp.stdout.pipe(ffmpeg.stdin);
  ytdlp.on('error', (err) => console.error('yt-dlp gagal dijalankan:', err.message));
  ffmpeg.on('error', (err) => console.error('ffmpeg gagal dijalankan:', err.message));
  ytdlp.stderr.resume();
  ffmpeg.stderr.resume();

  const cleanup = () => {
    ytdlp.kill('SIGKILL');
    ffmpeg.kill('SIGKILL');
  };

  return { stream: ffmpeg.stdout, cleanup };
}

function ensurePlayer(state, guildId) {
  if (state.player) return state.player;

  const player = createAudioPlayer();
  player.on(AudioPlayerStatus.Idle, () => {
    if (state.cleanupCurrent) {
      state.cleanupCurrent();
      state.cleanupCurrent = null;
    }
    state.current = null;
    playNext(state, guildId);
  });
  player.on('error', (err) => {
    console.error('Audio player error:', err.message);
    if (state.textChannel) {
      state.textChannel.send(`⚠️ Gagal memutar **${state.current?.title ?? 'lagu ini'}**, lanjut ke berikutnya.`).catch(() => {});
    }
    if (state.cleanupCurrent) {
      state.cleanupCurrent();
      state.cleanupCurrent = null;
    }
    state.current = null;
    playNext(state, guildId);
  });

  state.player = player;
  return player;
}

function playNext(state, guildId) {
  if (state.idleTimer) {
    clearTimeout(state.idleTimer);
    state.idleTimer = null;
  }

  const next = state.queue.shift();
  if (!next) {
    state.idleTimer = setTimeout(() => stopAndLeave(guildId), IDLE_LEAVE_MS);
    return;
  }

  const { stream, cleanup } = createAudioStream(next.url);
  state.cleanupCurrent = cleanup;
  state.current = next;

  const resource = createAudioResource(stream, { inputType: StreamType.Raw, inlineVolume: true });
  state.player.play(resource);

  if (state.textChannel) {
    state.textChannel.send(`🎵 Sekarang memutar: **${next.title}**\n${next.url}`).catch(() => {});
  }
}

function stopAndLeave(guildId) {
  const state = guildStates.get(guildId);
  if (!state) return;

  if (state.idleTimer) clearTimeout(state.idleTimer);
  if (state.cleanupCurrent) state.cleanupCurrent();
  state.queue = [];
  state.current = null;
  state.player?.stop(true);
  if (state.connection && state.connection.state.status !== VoiceConnectionStatus.Destroyed) {
    state.connection.destroy();
  }
  guildStates.delete(guildId);
}

async function playCommand(message, args) {
  const voiceChannel = message.member?.voice?.channel;
  if (!voiceChannel) return message.reply('Masuk ke voice channel dulu sebelum pakai command ini.');
  if (args.length === 0) return message.reply('Pakai: `!play <link YouTube atau Spotify>`');

  const permissions = voiceChannel.permissionsFor(message.guild.members.me);
  if (!permissions?.has('Connect') || !permissions?.has('Speak')) {
    return message.reply('Bot tidak punya izin **Connect**/**Speak** ke voice channel itu.');
  }

  let meta;
  try {
    meta = await resolveTrack(args.join(' '));
  } catch (err) {
    if (err instanceof UserFacingError) return message.reply(err.message);
    console.error('Gagal resolve track:', err.message);
    return message.reply('Gagal memproses link itu, coba lagi.');
  }

  const state = getState(message.guild.id);
  ensurePlayer(state, message.guild.id);
  state.textChannel = message.channel;

  if (!state.connection || state.connection.state.status === VoiceConnectionStatus.Destroyed) {
    state.connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: message.guild.id,
      adapterCreator: message.guild.voiceAdapterCreator,
      selfMute: false,
      selfDeaf: true,
    });
    state.connection.subscribe(state.player);
    state.connection.on('stateChange', (_, newState) => {
      if (newState.status === VoiceConnectionStatus.Destroyed || newState.status === VoiceConnectionStatus.Disconnected) {
        stopAndLeave(message.guild.id);
      }
    });
  }

  const track = { title: meta.title || meta.webpage_url, url: meta.webpage_url || meta.url };
  const wasIdle = state.player.state.status === AudioPlayerStatus.Idle && !state.current;

  state.queue.push(track);

  if (wasIdle) {
    playNext(state, message.guild.id);
  } else {
    await message.reply(`➕ Ditambahkan ke antrean: **${track.title}** (posisi #${state.queue.length})`);
  }
}

function skipCommand(message) {
  const state = guildStates.get(message.guild.id);
  if (!state?.current) return message.reply('Tidak ada yang sedang diputar.');
  message.reply(`⏭️ Skip: **${state.current.title}**`);
  state.player.stop();
}

function stopCommand(message) {
  const state = guildStates.get(message.guild.id);
  if (!state) return message.reply('Bot tidak sedang memutar apa-apa.');
  stopAndLeave(message.guild.id);
  return message.reply('⏹️ Berhenti & keluar dari voice channel.');
}

function pauseCommand(message) {
  const state = guildStates.get(message.guild.id);
  if (!state?.current) return message.reply('Tidak ada yang sedang diputar.');
  state.player.pause();
  return message.reply('⏸️ Dijeda.');
}

function resumeCommand(message) {
  const state = guildStates.get(message.guild.id);
  if (!state?.current) return message.reply('Tidak ada yang sedang diputar.');
  state.player.unpause();
  return message.reply('▶️ Dilanjutkan.');
}

function queueCommand(message) {
  const state = guildStates.get(message.guild.id);
  if (!state || (!state.current && state.queue.length === 0)) {
    return message.reply('Antrean kosong.');
  }
  const lines = [];
  if (state.current) lines.push(`▶️ Sedang diputar: **${state.current.title}**`);
  state.queue.forEach((t, i) => lines.push(`${i + 1}. ${t.title}`));
  return message.reply(lines.join('\n'));
}

module.exports = {
  playCommand,
  skipCommand,
  stopCommand,
  pauseCommand,
  resumeCommand,
  queueCommand,
};
