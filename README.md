# BotDc — Bot AFK Voice Channel & Activity Log

Bot Discord yang join ke voice channel lewat command dan tetap bertahan di sana (self-mute + self-deafen), dengan auto-reconnect kalau koneksi voice-nya putus. Bot ini juga memantau aksi moderasi di server (kick, ban, unban, force-disconnect/move voice, timeout) dan mengirim log-nya ke channel tertentu.

## Setup

1. Isi file `.env` (copy dari `.env.example`):
   ```
   TOKEN=token_bot_kamu
   PREFIX=!
   LOG_CHANNEL_ID=id_channel_untuk_activity_log
   ```
   `LOG_CHANNEL_ID` didapat dengan klik-kanan channel target (aktifkan Developer Mode di Discord dulu: Settings → Advanced) → **Copy Channel ID**. Kalau kosong, fitur activity log otomatis nonaktif.
2. Di [Discord Developer Portal](https://discord.com/developers/applications) → aplikasi bot kamu → tab **Bot**, aktifkan **Message Content Intent** (di bagian Privileged Gateway Intents). Tanpa ini, command `!join`/`!leavebylutfi`/`!help` tidak akan terbaca.
3. Undang bot ke server dengan scope `bot` dan permission minimal: **View Channel**, **Connect**, **Send Messages**, **Read Message History**, **View Audit Log** (wajib untuk activity log).
4. Install dependency (sudah dilakukan sekali):
   ```bash
   npm install
   ```
5. Jalankan bot:
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

Setiap kali ubah source code, jalankan ulang `docker compose up -d --build` supaya image ter-rebuild. Folder `data/` di-mount sebagai volume supaya channel AFK yang diingat (lihat bagian [Auto-Join](#auto-join--voice-attendance-log)) dan file log kehadiran voice tetap ada walau container di-rebuild — otomatis dibuat, tidak perlu setup manual.

## Command

- `!join` — jalankan sambil kamu sudah berada di sebuah voice channel; bot akan ikut masuk ke channel yang sama dan tetap di sana. Channel ini diingat buat auto-join kalau bot restart.
- `!leavebylutfi` — bot keluar dari voice channel, dan channel yang diingat buat auto-join dihapus.
- `!help` — tampilkan daftar command ini di Discord (tidak termasuk `!leavebylutfi`).

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

## Auto-Join & Voice Attendance Log

- **Auto-join**: begitu `!join` dipakai, channel voice-nya diingat (disimpan di `data/afk-channels.json`, per server). Kalau bot mati/restart (crash, redeploy, dsb), begitu nyala lagi bot otomatis join ke channel yang sama tanpa perlu `!join` ulang. `!leavebylutfi` menghapus channel yang diingat itu, jadi bot tidak auto-join lagi sampai `!join` dipakai lagi.
- **Voice attendance log**: implementasi di [voiceAttendanceLogger.js](voiceAttendanceLogger.js). Setiap ada member yang join/leave voice channel **yang sama dengan tempat bot berada**, dicatat (timestamp, nama, ID) ke `data/voice-attendance.log` dan ke console (`docker logs -f botdc`). **Sengaja tidak dikirim ke Discord sama sekali** — murni catatan lokal. File log-nya terus bertambah seiring waktu, tidak ada rotasi/pembersihan otomatis — hapus manual (`rm data/voice-attendance.log`) kalau sudah terlalu besar.

## Catatan

- Bot join dalam kondisi self-mute & self-deaf supaya hemat bandwidth — tidak mengirim/menerima audio apa pun.
- Kalau koneksi voice terputus tidak sengaja (network glitch, dsb), bot otomatis mencoba reconnect ke channel yang sama setelah beberapa detik.
- Total waktu di voice channel bisa dilihat langsung dari durasi bot ada di channel tersebut (misal lewat bot leveling/statistik lain yang sudah ada di server, atau widget member list Discord).
- Gunakan sesuai aturan server Discord tempat bot ini dipakai — sejumlah server melarang "AFK farming" untuk voice XP/reward, jadi pastikan kamu punya izin (terutama kalau bukan server milikmu sendiri).
