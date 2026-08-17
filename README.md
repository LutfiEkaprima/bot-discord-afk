# BotDc — Bot AFK Voice Channel, Activity Log & Live Notifier

Bot Discord yang join ke voice channel lewat command dan tetap bertahan di sana (self-mute + self-deafen), dengan auto-reconnect kalau koneksi voice-nya putus. Bot ini juga memantau aksi moderasi di server (kick, ban, unban, force-disconnect/move voice, timeout) dan mengirim log-nya ke channel tertentu, serta bisa memantau channel YouTube/akun TikTok tertentu dan mengirim notifikasi + link stream ke channel tertentu saat mereka live.

## Setup

1. Isi file `.env` (copy dari `.env.example`):
   ```
   TOKEN=token_bot_kamu
   PREFIX=!
   LOG_CHANNEL_ID=id_channel_untuk_activity_log
   LIVE_CHANNEL_ID=id_channel_untuk_notifikasi_live
   LIVE_POLL_INTERVAL_MS=180000
   ```
   ID channel didapat dengan klik-kanan channel target (aktifkan Developer Mode di Discord dulu: Settings → Advanced) → **Copy Channel ID**. Kalau `LOG_CHANNEL_ID` kosong, fitur activity log nonaktif; kalau `LOG_CHANNEL_ID` sama dengan `LIVE_CHANNEL_ID` juga boleh, keduanya bisa pakai channel yang sama. Kalau `LIVE_CHANNEL_ID` kosong, live monitor nonaktif. `LIVE_POLL_INTERVAL_MS` opsional (default 180000 ms / 3 menit) — jangan diset terlalu kecil supaya tidak dianggap spam/bot oleh YouTube atau TikTok.
2. Di [Discord Developer Portal](https://discord.com/developers/applications) → aplikasi bot kamu → tab **Bot**, aktifkan **Message Content Intent** (di bagian Privileged Gateway Intents). Tanpa ini, command `!join`/`!leavebylutfi` tidak akan terbaca.
3. Undang bot ke server dengan scope `bot` dan permission minimal: **View Channel**, **Connect**, **Send Messages**, **Read Message History**, **View Audit Log** (wajib untuk activity log).
4. Install dependency (sudah dilakukan sekali):
   ```bash
   npm install
   ```
5. Deteksi live TikTok butuh Chromium/Google Chrome asli (lihat bagian [Live Notifier](#live-notifier-youtube--tiktok)). Kalau jalanin lewat Docker, ini sudah otomatis. Kalau jalanin langsung pakai `npm start` di luar Docker, pastikan **Google Chrome** sudah ter-install di mesin kamu (bot otomatis memakainya) — kalau tidak ada Chrome, isi `CHROMIUM_EXECUTABLE_PATH` di `.env` dengan path ke Chromium/Chrome yang ada.
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

Setiap kali ubah source code (atau `Dockerfile`/`package.json`), jalankan ulang `docker compose up -d --build` supaya image ter-rebuild — image-nya sekarang menginstall Chromium juga (buat deteksi live TikTok), jadi build pertama setelah update ini bakal lebih lambat & image-nya lebih besar dari sebelumnya. Daftar pantau YouTube/TikTok disimpan di `data/watchlist.json`, dan folder `data/` di-mount sebagai volume di `docker-compose.yml` supaya datanya tetap tersimpan walau container di-rebuild — tidak perlu setup manual apa pun, foldernya otomatis dibuat.

## Command

- `!join` — jalankan sambil kamu sudah berada di sebuah voice channel; bot akan ikut masuk ke channel yang sama dan tetap di sana.
- `!leavebylutfi` — bot keluar dari voice channel.
- `!ytadd <channel_id / @handle / url> [label]` — tambah channel YouTube ke pemantauan live. Butuh izin **Manage Server**.
- `!ytremove <channel_id / @handle / url>` — hapus channel YouTube dari pemantauan.
- `!ytlist` — lihat daftar channel YouTube yang dipantau.
- `!ttadd <username / url> [label]` — tambah akun TikTok ke pemantauan live. Butuh izin **Manage Server**.
- `!ttremove <username / url>` — hapus akun TikTok dari pemantauan.
- `!ttlist` — lihat daftar akun TikTok yang dipantau.
- `!help` — tampilkan daftar command ini di Discord (tidak termasuk `!leavebylutfi`).

Contoh: `!ytadd @lofigirl Lofi Girl` atau `!ttadd tiktok TikTok Official`.

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

## Live Notifier (YouTube & TikTok)

Bot mengecek daftar channel YouTube dan akun TikTok yang ditambahkan lewat command `!ytadd`/`!ttadd` setiap `LIVE_POLL_INTERVAL_MS` (default 3 menit). Begitu terdeteksi live, bot mengirim embed berisi judul stream dan **link langsung ke streamnya** ke channel `LIVE_CHANNEL_ID`, sekali per sesi live (tidak akan berulang-ulang sampai stream itu berakhir dan live lagi).

Cara kerja deteksinya (implementasi di [liveMonitor.js](liveMonitor.js)):

- **YouTube**: membuka halaman `youtube.com/<channel>/live` dan membaca data live yang di-render Google di halaman itu (tidak butuh API key/kuota, cukup `fetch` biasa). Cukup andal karena YouTube memang menyisipkan status live langsung di HTML halaman tersebut.
- **TikTok**: TikTok **tidak punya API publik** untuk cek status live, dan berbeda dari YouTube, status live-nya **tidak pernah ada di HTML mentah** — TikTok baru menentukannya lewat JavaScript di browser lewat API internal yang wajib disertai token anti-bot (`X-Bogus`/`X-Gnarly`/`msToken`). Karena itu bot benar-benar membuka halaman `tiktok.com/@user/live` pakai **Chromium headless** (lewat [`playwright-core`](https://playwright.dev/)) dan menunggu elemen `<video>` player-nya muncul — kalau ada, berarti stream-nya benar-benar sedang berjalan.
  - Judul halaman (`document.title`) **tidak dipakai** sebagai sinyal, walau sekilas kelihatan berguna (berubah jadi mengandung teks "is LIVE" saat live) — soalnya judul itu tetap nyangkut ke teks itu juga untuk akun yang live-nya **sudah berakhir**, jadi kalau dipakai sendirian bakal salah deteksi terus-menerus "masih live" walau sudah tidak. Sudah diverifikasi ulang terhadap 3 kondisi nyata: akun yang genuinely live (video ada), akun yang live-nya sudah berakhir (video tidak ada, walau title masih salah bilang live), dan akun yang tidak pernah live.
  - Konsekuensinya: setiap pengecekan akun TikTok lebih berat & lebih lambat (perlu buka halaman sungguhan, beberapa detik per akun) dibanding YouTube, dan butuh lebih banyak RAM/CPU. Browser Chromium-nya dibuka sekali dan dipakai ulang terus (bukan buka-tutup tiap poll), dan hanya aktif kalau ada minimal satu akun TikTok yang dipantau.
  - TikTok tetap bisa berubah struktur/perilakunya kapan saja — kalau suatu saat deteksi ini berhenti akurat, bagian `checkTiktokEntry` di `liveMonitor.js` perlu disesuaikan lagi.

Data channel/akun yang dipantau disimpan di `data/watchlist.json` (di-generate otomatis, tidak masuk git).

## Catatan

- Bot join dalam kondisi self-mute & self-deaf supaya hemat bandwidth — tidak mengirim/menerima audio apa pun.
- Kalau koneksi voice terputus tidak sengaja (network glitch, dsb), bot otomatis mencoba reconnect ke channel yang sama setelah beberapa detik.
- Total waktu di voice channel bisa dilihat langsung dari durasi bot ada di channel tersebut (misal lewat bot leveling/statistik lain yang sudah ada di server, atau widget member list Discord).
- Gunakan sesuai aturan server Discord tempat bot ini dipakai — sejumlah server melarang "AFK farming" untuk voice XP/reward, jadi pastikan kamu punya izin (terutama kalau bukan server milikmu sendiri).
