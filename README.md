# BotDc — Bot AFK Voice Channel, Activity Log & Music Player

Bot Discord yang join ke voice channel lewat command dan tetap bertahan di sana (self-mute + self-deafen), dengan auto-reconnect kalau koneksi voice-nya putus. Bot ini juga memantau aksi moderasi di server (kick, ban, unban, force-disconnect/move voice, timeout) dan mengirim log-nya ke channel tertentu, serta bisa memutar musik dari link YouTube atau Spotify langsung di voice channel.

## Setup

1. Isi file `.env` (copy dari `.env.example`):
   ```
   TOKEN=token_bot_kamu
   PREFIX=!
   LOG_CHANNEL_ID=id_channel_untuk_activity_log
   ```
   `LOG_CHANNEL_ID` didapat dengan klik-kanan channel target (aktifkan Developer Mode di Discord dulu: Settings → Advanced) → **Copy Channel ID**. Kalau kosong, fitur activity log otomatis nonaktif.
2. Di [Discord Developer Portal](https://discord.com/developers/applications) → aplikasi bot kamu → tab **Bot**, aktifkan **Message Content Intent** (di bagian Privileged Gateway Intents). Tanpa ini, command `!join`/`!leavebylutfi`/`!play` dkk tidak akan terbaca.
3. Undang bot ke server dengan scope `bot` dan permission minimal: **View Channel**, **Connect**, **Speak**, **Send Messages**, **Read Message History**, **View Audit Log** (wajib untuk activity log).
4. Install dependency (sudah dilakukan sekali):
   ```bash
   npm install
   ```
5. Fitur `!play` butuh **yt-dlp** dan **ffmpeg** ter-install di mesin kamu (lihat bagian [Music Player](#music-player)). Kalau jalanin lewat Docker, ini sudah otomatis ke-install. Kalau jalanin langsung pakai `npm start` di luar Docker, install dulu keduanya (mis. `pip install yt-dlp` dan ffmpeg dari [ffmpeg.org](https://ffmpeg.org/download.html) atau package manager OS kamu) dan pastikan ada di PATH — atau set `YTDLP_PATH`/`FFMPEG_PATH` di `.env` kalau lokasinya beda.
6. Jalankan bot:
   ```bash
   npm start
   ```

### Jalankan dengan Docker Compose

Alternatif tanpa perlu install Node.js di host, cukup Docker:

1. Pastikan `.env` sudah diisi (langkah 1 di atas).
2. Build & jalankan:
   ```bash
   docker compose up -d --build
   ```
3. Lihat log:
   ```bash
   docker compose logs -f
   ```
4. Stop bot:
   ```bash
   docker compose down
   ```

Setiap kali ubah source code (atau `Dockerfile`/`package.json`), jalankan ulang `docker compose up -d --build` supaya image ter-rebuild — image-nya sudah menginstall `yt-dlp` dan `ffmpeg` otomatis.

## Command

- `!join` — jalankan sambil kamu sudah berada di sebuah voice channel; bot akan ikut masuk ke channel yang sama dan tetap di sana.
- `!leavebylutfi` — bot keluar dari voice channel.
- `!play <link YouTube atau Spotify>` — putar lagu dari link (1 lagu) di voice channel kamu. Kalau sedang ada yang diputar, otomatis masuk antrean.
- `!skip` — lewati lagu yang sedang diputar.
- `!pause` / `!resume` — jeda / lanjutkan lagu yang sedang diputar.
- `!stop` — berhenti, kosongkan antrean, bot keluar dari voice channel.
- `!queue` — lihat lagu yang sedang diputar dan antrean berikutnya.
- `!help` — tampilkan daftar command ini di Discord (tidak termasuk `!leavebylutfi`).

Contoh: `!play https://www.youtube.com/watch?v=dQw4w9WgXcQ` atau `!play https://open.spotify.com/track/7qiZfU4dY1lWllzX7mPBI3`.

Prefix bisa diganti lewat variabel `PREFIX` di `.env`.

## Activity Log

Bot memantau [Audit Log](https://support.discord.com/hc/en-us/articles/4406779720343-How-to-Use-Audit-Log) server secara real-time dan mengirim embed ke channel `LOG_CHANNEL_ID` untuk aksi-aksi berikut:

- 🔨 Member di-**kick**
- ⛔ Member di-**ban** / ✅ di-**unban**
- 🔇 Member di-**timeout** / 🔊 timeout dicabut
- 🔌 Member di-**disconnect** paksa dari voice channel
- ↔️ Member **dipindahkan** (move) ke voice channel lain

Setiap log menampilkan siapa yang jadi target, siapa moderator yang melakukan (kalau tercatat di audit log), dan alasannya (kalau diisi).

**Catatan keterbatasan Discord:** untuk aksi disconnect/move voice yang dilakukan massal (mis. tombol "Disconnect All"), audit log Discord hanya mencatat jumlah member yang terdampak, bukan nama masing-masing — bot akan menampilkan jumlahnya saja tanpa menyebut member spesifik.

Fitur ini hanya mencatat aksi moderasi (bukan join/leave biasa atau chat). Kalau butuh log tambahan (mis. member baru join/leave, pesan dihapus, perubahan role), tinggal tambah handler baru di [activityLogger.js](activityLogger.js).

## Music Player

Cara kerjanya (implementasi di [musicPlayer.js](musicPlayer.js)):

- **Link YouTube**: audionya diambil langsung pakai [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) (dijalankan sebagai proses terpisah, bukan library JS) — yt-dlp dipilih karena proyek itu aktif dirawat khusus buat mengikuti perubahan YouTube, jauh lebih tahan lama dibanding scraping/library JS yang gampang basi. Hasilnya di-pipe ke `ffmpeg` buat di-transcode jadi PCM mentah yang langsung bisa dipakai `@discordjs/voice`.
- **Link Spotify**: Spotify tidak punya audio yang bisa diputar lewat API publik (karena DRM), jadi bot cuma membaca judul lagu + nama artis dari meta tag halaman track-nya (tanpa perlu daftar App/API key ke Spotify), lalu **mencari lagu yang sama di YouTube** dan memutar audio dari sana.
- Cuma mendukung link **1 lagu (track)** untuk kedua platform — link playlist/album ditolak dengan pesan yang jelas, belum didukung.
- Antrean per-server: kalau ada lagu yang sedang diputar, `!play` berikutnya masuk antrean, bukan interupsi.
- Bot otomatis keluar dari voice channel kalau antrean kosong selama 5 menit.

**Catatan legal:** yt-dlp mengunduh/streaming audio dari YouTube, yang secara teknis melanggar Terms of Service YouTube meskipun jamak dipakai untuk bot Discord personal/privat. Gunakan dengan bijak dan sesuai kebijakan server Discord tempat bot ini dipakai.

**Troubleshooting `!play` gagal ("Gagal memproses link itu"):** YouTube sering mengubah cara kerjanya buat mempersulit tool seperti yt-dlp, jadi yt-dlp **harus** sering di-update — kalau tidak, ekstraksinya bisa mulai gagal kapan saja. Langkah cek:

1. Lihat pesan error aslinya di log (`docker compose logs -f` atau `docker logs -f botdc`) — error yang dikirim ke Discord sengaja digeneralisir, tapi detail aslinya (dari yt-dlp/ffmpeg) selalu di-`console.error` duluan.
2. `Dockerfile` install yt-dlp lewat pip (`pip3 install yt-dlp`) supaya dapat rilis terbaru dari PyPI saat build — **tapi** Docker mengcache layer itu, jadi rebuild biasa (`docker compose up -d --build`) belum tentu narik ulang versi terbaru kalau layer-nya belum berubah. Kalau `!play` YouTube berhenti berfungsi padahal sebelumnya normal, coba build ulang tanpa cache dulu:
   ```bash
   docker compose build --no-cache
   docker compose up -d
   ```
   Ini memaksa `pip3 install yt-dlp` jalan ulang dan ambil versi paling baru.
3. Kalau errornya persis **"Sign in to confirm you're not a bot"** — ini bukan soal versi yt-dlp basi, tapi YouTube memang mendeteksi & memblokir request dari IP VPS/datacenter (umum banget kalau bot di-hosting di cloud/VPS). Solusinya: kasih yt-dlp cookies dari sesi browser yang sudah login, supaya requestnya dianggap datang dari pengguna asli, bukan bot. Caranya:
   1. Di browser kamu (bukan di server), install extension **"Get cookies.txt LOCALLY"** ([Chrome Web Store](https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc)) atau sejenisnya.
   2. Login ke YouTube pakai akun Google. **Sangat disarankan pakai akun Google kedua/khusus, bukan akun pribadi utama kamu** — lihat catatan keamanan di bawah.
   3. Buka youtube.com, klik extension-nya, export cookies buat domain `youtube.com`, simpan sebagai `cookies.txt`.
   4. Copy file `cookies.txt` itu ke folder project ini di VM (folder yang sama dengan `docker-compose.yml`).
   5. Di `.env`, isi `YTDLP_COOKIES_PATH=/app/cookies.txt`.
   6. Di `docker-compose.yml`, un-comment 2 baris `volumes:` yang sudah disediakan (mount `cookies.txt` ke dalam container).
   7. Rebuild & jalankan ulang: `docker compose up -d --build`.

   **Catatan keamanan penting:** `cookies.txt` isinya token sesi login akun Google itu — siapa pun yang pegang file ini bisa "menyamar" jadi akun tersebut di YouTube selama sesinya masih berlaku, sama bahayanya kayak bocorin password. Jangan pernah commit file ini ke git (sudah di-`.gitignore`-kan), **jangan pernah tempel isinya ke tempat lain (chat, issue, dsb)**, dan **pakai akun Google terpisah khusus buat bot ini** — idealnya di-export dari profil Chrome terpisah/jendela Incognito yang cuma login akun itu saja, supaya tidak mungkin ke-mix sama akun pribadimu. Sesi login ini juga bisa expired/diminta re-verifikasi oleh Google sewaktu-waktu (apalagi karena diakses dari IP VPS) — kalau `!play` mulai gagal lagi dengan error yang sama, ulangi langkah export cookies-nya.

   **Penting:** volume mount `cookies.txt`-nya harus **writable**, bukan read-only (`:ro`) — yt-dlp selalu menulis ulang file itu tiap selesai jalan buat menyimpan cookies yang di-refresh Google. Kalau mount-nya `:ro`, `!play` akan gagal dengan error `OSError: Read-only file system`.
4. Kalau errornya sesuatu seperti **"The page needs to be reloaded"** — ini error dari yt-dlp/YouTube sendiri, biasanya transient (coba lagi beberapa saat) atau tanda videonya butuh langkah ekstra (age-restricted, dsb). Coba dulu dengan link video lain yang umum/populer buat pastikan bukan masalah cookies/setup — kalau video lain lancar tapi satu video tertentu selalu gagal begini, kemungkinan videonya sendiri yang bermasalah, bukan setupnya.

## Catatan

- Bot join dalam kondisi self-mute & self-deaf (khusus command `!join`) supaya hemat bandwidth — tidak mengirim/menerima audio apa pun. Saat memutar musik lewat `!play`, bot join dengan audio aktif (tidak self-mute) supaya bisa terdengar.
- Kalau koneksi voice terputus tidak sengaja (network glitch, dsb) saat pakai `!join`, bot otomatis mencoba reconnect ke channel yang sama setelah beberapa detik.
- Total waktu di voice channel bisa dilihat langsung dari durasi bot ada di channel tersebut (misal lewat bot leveling/statistik lain yang sudah ada di server, atau widget member list Discord).
- Gunakan sesuai aturan server Discord tempat bot ini dipakai — sejumlah server melarang "AFK farming" untuk voice XP/reward, jadi pastikan kamu punya izin (terutama kalau bukan server milikmu sendiri).
