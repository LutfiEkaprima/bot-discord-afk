# BotDc — Bot AFK Voice Channel

Bot Discord sederhana yang join ke voice channel lewat command dan tetap bertahan di sana (self-mute + self-deafen), dengan auto-reconnect kalau koneksi voice-nya putus.

## Setup

1. Isi file `.env` (copy dari `.env.example`):
   ```
   TOKEN=token_bot_kamu
   PREFIX=!
   ```
2. Di [Discord Developer Portal](https://discord.com/developers/applications) → aplikasi bot kamu → tab **Bot**, aktifkan **Message Content Intent** (di bagian Privileged Gateway Intents). Tanpa ini, command `!join`/`!leave` tidak akan terbaca.
3. Undang bot ke server dengan scope `bot` dan permission minimal: **View Channel**, **Connect**, **Send Messages**, **Read Message History**.
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

Setiap kali ubah `index.js`, jalankan ulang `docker compose up -d --build` supaya image ter-rebuild.

## Command

- `!join` — jalankan sambil kamu sudah berada di sebuah voice channel; bot akan ikut masuk ke channel yang sama dan tetap di sana.
- `!leave` — bot keluar dari voice channel.

Prefix bisa diganti lewat variabel `PREFIX` di `.env`.

## Catatan

- Bot join dalam kondisi self-mute & self-deaf supaya hemat bandwidth — tidak mengirim/menerima audio apa pun.
- Kalau koneksi voice terputus tidak sengaja (network glitch, dsb), bot otomatis mencoba reconnect ke channel yang sama setelah beberapa detik.
- Total waktu di voice channel bisa dilihat langsung dari durasi bot ada di channel tersebut (misal lewat bot leveling/statistik lain yang sudah ada di server, atau widget member list Discord).
- Gunakan sesuai aturan server Discord tempat bot ini dipakai — sejumlah server melarang "AFK farming" untuk voice XP/reward, jadi pastikan kamu punya izin (terutama kalau bukan server milikmu sendiri).
