const { AuditLogEvent, EmbedBuilder } = require('discord.js');

const COLORS = {
  kick: 0xe74c3c,
  ban: 0x992d22,
  unban: 0x2ecc71,
  disconnect: 0xe67e22,
  move: 0xf1c40f,
  timeout: 0x9b59b6,
};

function setupActivityLogger(client) {
  const logChannelId = process.env.LOG_CHANNEL_ID;
  if (!logChannelId) {
    console.warn('LOG_CHANNEL_ID belum diisi di .env — activity log dinonaktifkan.');
    return;
  }

  client.on('guildAuditLogEntryCreate', (entry, guild) => {
    handleEntry(entry, guild, logChannelId).catch((err) => {
      console.error('Gagal memproses audit log entry:', err);
    });
  });
}

async function sendLog(guild, logChannelId, embed) {
  const channel =
    guild.channels.cache.get(logChannelId) ??
    (await guild.channels.fetch(logChannelId).catch(() => null));
  if (!channel || !channel.isTextBased()) return;
  await channel.send({ embeds: [embed] }).catch((err) => {
    console.error('Gagal mengirim log ke channel:', err.message);
  });
}

// Audit log entries dari gateway hanya membawa target_id, bukan objek user lengkap.
// Fallback fetch lewat REST supaya tag/username tetap tampil walau user belum ada di cache.
async function resolveTarget(entry, guild) {
  if (entry.target) return entry.target;
  if (!entry.targetId) return null;
  return guild.client.users.fetch(entry.targetId).catch(() => null);
}

function baseEmbed(color) {
  return new EmbedBuilder().setColor(color).setTimestamp();
}

function executorLabel(executor) {
  return executor ? `${executor.tag}` : 'Tidak diketahui';
}

async function handleEntry(entry, guild, logChannelId) {
  const { action, executor, reason } = entry;

  switch (action) {
    case AuditLogEvent.MemberKick: {
      const target = await resolveTarget(entry, guild);
      const embed = baseEmbed(COLORS.kick)
        .setTitle('🔨 Member di-kick')
        .setDescription(`**${target?.tag ?? entry.targetId ?? 'Unknown'}** dikeluarkan dari server.`)
        .addFields(
          { name: 'Oleh', value: executorLabel(executor), inline: true },
          { name: 'Alasan', value: reason || '-', inline: true },
        );
      return sendLog(guild, logChannelId, embed);
    }

    case AuditLogEvent.MemberBanAdd: {
      const target = await resolveTarget(entry, guild);
      const embed = baseEmbed(COLORS.ban)
        .setTitle('⛔ Member di-ban')
        .setDescription(`**${target?.tag ?? entry.targetId ?? 'Unknown'}** dibanned dari server.`)
        .addFields(
          { name: 'Oleh', value: executorLabel(executor), inline: true },
          { name: 'Alasan', value: reason || '-', inline: true },
        );
      return sendLog(guild, logChannelId, embed);
    }

    case AuditLogEvent.MemberBanRemove: {
      const target = await resolveTarget(entry, guild);
      const embed = baseEmbed(COLORS.unban)
        .setTitle('✅ Member di-unban')
        .setDescription(`**${target?.tag ?? entry.targetId ?? 'Unknown'}** dihapus dari daftar ban.`)
        .addFields({ name: 'Oleh', value: executorLabel(executor), inline: true });
      return sendLog(guild, logChannelId, embed);
    }

    case AuditLogEvent.MemberDisconnect: {
      const count = entry.extra?.count ?? 1;
      const embed = baseEmbed(COLORS.disconnect)
        .setTitle('🔌 Member di-disconnect dari voice')
        .setDescription(
          count === 1
            ? 'Satu member di-disconnect paksa dari voice channel.'
            : `${count} member di-disconnect paksa dari voice channel.`,
        )
        .addFields({ name: 'Oleh', value: executorLabel(executor), inline: true });
      return sendLog(guild, logChannelId, embed);
    }

    case AuditLogEvent.MemberMove: {
      const count = entry.extra?.count ?? 1;
      const channelName = entry.extra?.channel?.name ?? entry.extra?.channel?.id ?? 'channel lain';
      const embed = baseEmbed(COLORS.move)
        .setTitle('↔️ Member dipindahkan voice channel')
        .setDescription(
          `${count === 1 ? 'Satu member' : `${count} member`} dipindahkan ke **${channelName}**.`,
        )
        .addFields({ name: 'Oleh', value: executorLabel(executor), inline: true });
      return sendLog(guild, logChannelId, embed);
    }

    case AuditLogEvent.MemberUpdate: {
      const timeoutChange = entry.changes?.find((change) => change.key === 'communication_disabled_until');
      if (!timeoutChange) return;

      const target = await resolveTarget(entry, guild);
      const untilRaw = timeoutChange.new;
      const isActive = Boolean(untilRaw) && new Date(untilRaw).getTime() > Date.now();

      const embed = baseEmbed(COLORS.timeout)
        .setTitle(isActive ? '🔇 Member di-timeout' : '🔊 Timeout member dicabut')
        .setDescription(`**${target?.tag ?? entry.targetId ?? 'Unknown'}**`)
        .addFields(
          { name: 'Oleh', value: executorLabel(executor), inline: true },
          { name: 'Alasan', value: reason || '-', inline: true },
        );
      if (isActive) {
        embed.addFields({
          name: 'Sampai',
          value: `<t:${Math.floor(new Date(untilRaw).getTime() / 1000)}:F>`,
          inline: true,
        });
      }
      return sendLog(guild, logChannelId, embed);
    }

    default:
      return;
  }
}

module.exports = { setupActivityLogger };
