const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');

const DATA_FILE = path.join(__dirname, 'watchlist.json');
const POLL_INTERVAL_MS = Number(process.env.LIVE_POLL_INTERVAL_MS) || 3 * 60 * 1000;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function loadWatchlist() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { youtube: [], tiktok: [] };
  }
}

function saveWatchlist() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(watchlist, null, 2));
}

const watchlist = loadWatchlist();
if (!Array.isArray(watchlist.youtube)) watchlist.youtube = [];
if (!Array.isArray(watchlist.tiktok)) watchlist.tiktok = [];

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  return res.text();
}

// --- YouTube ---------------------------------------------------------------

function normalizeYoutubeInput(input) {
  let value = input.trim();
  value = value.replace(/^https?:\/\/(www\.)?youtube\.com\//i, '');
  value = value.replace(/\/(live|videos|streams|featured)\/?.*$/i, '');

  if (value.startsWith('channel/')) {
    const id = value.slice('channel/'.length);
    return { type: 'channel', id, key: id };
  }
  const handle = value.replace(/^@/, '');
  if (/^UC[\w-]{22}$/.test(handle)) {
    return { type: 'channel', id: handle, key: handle };
  }
  return { type: 'handle', id: handle, key: `@${handle}` };
}

function youtubeLiveUrl(entry) {
  return entry.type === 'channel'
    ? `https://www.youtube.com/channel/${entry.id}/live`
    : `https://www.youtube.com/@${entry.id}/live`;
}

function addYoutube(rawInput, label) {
  const normalized = normalizeYoutubeInput(rawInput);
  if (watchlist.youtube.some((e) => e.key === normalized.key)) {
    return { added: false };
  }
  const entry = {
    key: normalized.key,
    type: normalized.type,
    id: normalized.id,
    label: label || normalized.key,
    isLive: false,
    lastVideoId: null,
  };
  watchlist.youtube.push(entry);
  saveWatchlist();
  return { added: true, entry };
}

function removeYoutube(rawInput) {
  const normalized = normalizeYoutubeInput(rawInput);
  const index = watchlist.youtube.findIndex((e) => e.key === normalized.key);
  if (index === -1) return false;
  watchlist.youtube.splice(index, 1);
  saveWatchlist();
  return true;
}

function listYoutube() {
  return watchlist.youtube;
}

// Deteksi berbasis scraping halaman /live: kalau channel sedang live, halaman ini
// berisi blok `ytInitialPlayerResponse` dengan videoDetails.isLive = true. Kalau
// tidak live, blok itu tidak ada (halaman hanya menampilkan channel biasa).
async function checkYoutubeEntry(entry) {
  const body = await fetchText(youtubeLiveUrl(entry));
  const match = body.match(/var ytInitialPlayerResponse = (\{.*?\});/s);
  if (!match) return { isLive: false };

  let data;
  try {
    data = JSON.parse(match[1]);
  } catch {
    return { isLive: false };
  }

  const details = data.videoDetails;
  if (!details?.isLive) return { isLive: false };

  return {
    isLive: true,
    videoId: details.videoId,
    title: details.title,
    channelName: details.author,
    thumbnail: details.thumbnail?.thumbnails?.slice(-1)[0]?.url,
  };
}

function buildYoutubeEmbed(entry, result) {
  const url = `https://youtu.be/${result.videoId}`;
  return new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle(`🔴 ${result.channelName ?? entry.label} sedang LIVE di YouTube!`)
    .setDescription(result.title ?? '-')
    .setURL(url)
    .setImage(result.thumbnail ?? null)
    .addFields({ name: 'Tonton', value: url })
    .setTimestamp();
}

// --- TikTok ------------------------------------------------------------------

function normalizeTiktokInput(input) {
  let value = input.trim();
  value = value.replace(/^https?:\/\/(www\.)?tiktok\.com\//i, '');
  value = value.replace(/\/live\/?.*$/i, '');
  value = value.replace(/^@/, '');
  return value.split(/[/?]/)[0];
}

function addTiktok(rawInput, label) {
  const username = normalizeTiktokInput(rawInput);
  if (watchlist.tiktok.some((e) => e.username === username)) {
    return { added: false };
  }
  const entry = { username, label: label || username, isLive: false };
  watchlist.tiktok.push(entry);
  saveWatchlist();
  return { added: true, entry };
}

function removeTiktok(rawInput) {
  const username = normalizeTiktokInput(rawInput);
  const index = watchlist.tiktok.findIndex((e) => e.username === username);
  if (index === -1) return false;
  watchlist.tiktok.splice(index, 1);
  saveWatchlist();
  return true;
}

function listTiktok() {
  return watchlist.tiktok;
}

// TikTok tidak punya API publik untuk status live. Ini scraping best-effort:
// saat akun sedang live, HTML halaman /live mengandung blok JSON
// `__UNIVERSAL_DATA_FOR_REHYDRATION__` berisi data `webapp.live-detail`.
// Saat tidak live, key ini sama sekali tidak ada di halaman.
// TikTok bisa mengubah struktur ini kapan saja tanpa pemberitahuan.
async function checkTiktokEntry(entry) {
  const url = `https://www.tiktok.com/@${entry.username}/live`;
  const body = await fetchText(url);

  const match = body.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>(.*?)<\/script>/s);
  if (!match) return { isLive: false };

  let data;
  try {
    data = JSON.parse(match[1]);
  } catch {
    return { isLive: false };
  }

  const liveDetail = data?.__DEFAULT_SCOPE__?.['webapp.live-detail'];
  if (!liveDetail) return { isLive: false };

  const liveRoom = liveDetail.liveRoomUserInfo?.liveRoom ?? liveDetail.liveRoom ?? liveDetail;
  const status = liveRoom?.status ?? liveDetail.status;
  if (status !== undefined && status !== 2) return { isLive: false };

  return {
    isLive: true,
    title: liveRoom?.title ?? null,
    cover: liveRoom?.coverUrl ?? liveRoom?.cover?.url_list?.[0] ?? null,
    url,
  };
}

function buildTiktokEmbed(entry, result) {
  return new EmbedBuilder()
    .setColor(0x000000)
    .setTitle(`🔴 ${entry.label} sedang LIVE di TikTok!`)
    .setDescription(result.title ?? '-')
    .setURL(result.url)
    .setImage(result.cover ?? null)
    .addFields({ name: 'Tonton', value: result.url })
    .setTimestamp();
}

// --- Polling loop --------------------------------------------------------

async function notify(client, channelId, embed) {
  const channel =
    client.channels.cache.get(channelId) ?? (await client.channels.fetch(channelId).catch(() => null));
  if (!channel || !channel.isTextBased()) return;
  await channel.send({ embeds: [embed] }).catch((err) => {
    console.error('Gagal mengirim notifikasi live:', err.message);
  });
}

async function pollYoutube(client, channelId) {
  for (const entry of watchlist.youtube) {
    let result;
    try {
      result = await checkYoutubeEntry(entry);
    } catch (err) {
      console.error(`Gagal cek YouTube ${entry.label}:`, err.message);
      continue;
    }

    if (result.isLive && (!entry.isLive || entry.lastVideoId !== result.videoId)) {
      entry.isLive = true;
      entry.lastVideoId = result.videoId;
      saveWatchlist();
      await notify(client, channelId, buildYoutubeEmbed(entry, result));
    } else if (!result.isLive && entry.isLive) {
      entry.isLive = false;
      saveWatchlist();
    }
  }
}

async function pollTiktok(client, channelId) {
  for (const entry of watchlist.tiktok) {
    let result;
    try {
      result = await checkTiktokEntry(entry);
    } catch (err) {
      console.error(`Gagal cek TikTok ${entry.label}:`, err.message);
      continue;
    }

    if (result.isLive && !entry.isLive) {
      entry.isLive = true;
      saveWatchlist();
      await notify(client, channelId, buildTiktokEmbed(entry, result));
    } else if (!result.isLive && entry.isLive) {
      entry.isLive = false;
      saveWatchlist();
    }
  }
}

function startLiveMonitor(client) {
  const channelId = process.env.LIVE_CHANNEL_ID;
  if (!channelId) {
    console.warn('LIVE_CHANNEL_ID belum diisi di .env — live monitor dinonaktifkan.');
    return;
  }

  const tick = async () => {
    await pollYoutube(client, channelId);
    await pollTiktok(client, channelId);
  };

  tick();
  setInterval(tick, POLL_INTERVAL_MS);
}

module.exports = {
  startLiveMonitor,
  addYoutube,
  removeYoutube,
  listYoutube,
  addTiktok,
  removeTiktok,
  listTiktok,
};
