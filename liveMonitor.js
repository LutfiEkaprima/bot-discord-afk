const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const { chromium } = require('playwright-core');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'watchlist.json');
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
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(watchlist, null, 2));
}

const watchlist = loadWatchlist();
if (!Array.isArray(watchlist.youtube)) watchlist.youtube = [];
if (!Array.isArray(watchlist.tiktok)) watchlist.tiktok = [];

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: controller.signal,
    });
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// Bungkus satu pengecekan dengan batas waktu keras. Tanpa ini, satu request
// yang macet (network hiccup, dsb) bisa membuat satu siklus poll tidak pernah
// selesai — dan karena setInterval tidak menunggu siklus sebelumnya beres,
// siklus-siklus berikutnya numpuk di atasnya (makin lama makin banyak context
// Chromium kebuka bersamaan) sampai akhirnya kehabisan memori.
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout ${ms}ms saat cek ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
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

// TikTok tidak punya API publik untuk status live, dan (berbeda dari YouTube)
// status live-nya tidak pernah muncul di HTML mentah — TikTok baru menentukan
// & merender status live lewat JavaScript di browser, pakai API internal yang
// wajib disertai token anti-bot (X-Bogus/X-Gnarly/msToken) yang dihitung oleh
// JS TikTok sendiri. Karena itu satu-satunya cara yang reliable adalah benar-benar
// membuka halamannya lewat browser headless dan mengecek elemen <video> player-nya
// (lihat checkTiktokEntry) — document.title saja tidak cukup, karena tetap
// nyangkut bertuliskan "is LIVE" walau live-nya sudah lama berakhir.
const BROWSER_MAX_AGE_MS = 6 * 60 * 60 * 1000; // recycle tiap 6 jam, jaga-jaga kalau ada leak internal Chromium

let browserPromise = null;
let browserLaunchedAt = 0;

async function getBrowser() {
  if (browserPromise) {
    const browser = await browserPromise;
    const expired = Date.now() - browserLaunchedAt > BROWSER_MAX_AGE_MS;
    if (browser.isConnected() && !expired) return browser;
    await browser.close().catch(() => {});
    browserPromise = null;
  }

  const launchOptions = {
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  };
  if (process.env.CHROMIUM_EXECUTABLE_PATH) {
    launchOptions.executablePath = process.env.CHROMIUM_EXECUTABLE_PATH;
  } else {
    // Dev lokal tanpa Docker: pakai Google Chrome yang sudah ter-install di mesin.
    launchOptions.channel = 'chrome';
  }

  browserLaunchedAt = Date.now();
  browserPromise = chromium.launch(launchOptions);
  return browserPromise;
}

async function checkTiktokEntry(entry) {
  const url = `https://www.tiktok.com/@${entry.username}/live`;
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    locale: 'en-US',
    viewport: { width: 1280, height: 800 },
  });

  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    // document.title tidak bisa dipercaya sendirian: begitu sebuah akun pernah
    // live, title halamannya tetap nyangkut "is LIVE" walau live-nya sudah
    // lama berakhir. Sinyal yang benar-benar akurat adalah elemen <video>
    // player-nya — itu cuma dirender kalau stream-nya benar-benar sedang
    // berjalan. Tunggu sampai video itu muncul (atau timeout kalau memang
    // tidak live).
    await page.waitForSelector('video', { timeout: 8_000 }).catch(() => null);

    const videoCount = await page.locator('video').count();
    if (videoCount === 0) return { isLive: false };

    const title = await page.title();
    const cover = await page
      .locator('meta[property="og:image"]')
      .getAttribute('content')
      .catch(() => null);

    return { isLive: true, title, cover, url };
  } finally {
    await context.close().catch(() => {});
  }
}

function buildTiktokEmbed(entry, result) {
  return new EmbedBuilder()
    .setColor(0x000000)
    .setTitle(`🔴 ${entry.label} sedang LIVE di TikTok!`)
    .setDescription(result.title ?? 'Sedang live sekarang di TikTok.')
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
      result = await withTimeout(checkYoutubeEntry(entry), 30_000, `YouTube ${entry.label}`);
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
  if (watchlist.tiktok.length === 0) return;

  for (const entry of watchlist.tiktok) {
    let result;
    try {
      result = await withTimeout(checkTiktokEntry(entry), 45_000, `TikTok @${entry.username}`);
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

  let running = false;
  const tick = async () => {
    // setInterval tidak menunggu callback sebelumnya selesai — tanpa kunci ini,
    // satu siklus yang lambat/macet bisa numpuk dengan siklus berikutnya dan
    // dobel-buka context Chromium tanpa batas.
    if (running) {
      console.warn('Siklus live-monitor sebelumnya masih berjalan, skip siklus ini.');
      return;
    }
    running = true;
    try {
      await pollYoutube(client, channelId);
      await pollTiktok(client, channelId);
    } catch (err) {
      console.error('Live monitor tick gagal:', err);
    } finally {
      running = false;
    }
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
