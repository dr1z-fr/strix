/* =========================================================
   STRIX // Discord webhook helper
   Fire-and-forget posting of embed payloads.
   ========================================================= */

const COLOR = {
  green:  0x6FCF97,
  amber:  0xE0B341,
  red:    0xD46161,
  steel:  0x4F5F73,
  ink:    0x1A1F26,
};

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleString('fr-FR', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return String(iso); }
}
function fmtDay(d) {
  try {
    return new Date(d).toLocaleDateString('fr-FR', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  } catch { return String(d); }
}

async function send(webhookUrl, embed) {
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'STRIX Command',
        embeds: [embed],
      }),
    });
  } catch (err) {
    console.error('[discord] post failed:', err.message);
  }
}

// =====================================================================
// OPERATIONS
// =====================================================================
export function notifyOpCreated(op, actor) {
  const url = process.env.DISCORD_WEBHOOK_OPS;
  return send(url, {
    title: `🎯 Nouvelle opération — ${op.name}`,
    color: COLOR.green,
    fields: [
      { name: 'Date',     value: fmtDate(op.date), inline: true },
      { name: 'Zone',     value: op.zone || '—',    inline: true },
      { name: 'Priorité', value: (op.priority || '').toUpperCase(), inline: true },
      ...(op.brief ? [{ name: 'Brief', value: op.brief.slice(0, 1024) }] : []),
    ],
    footer: { text: `Créée par ${actor || '—'}` },
    timestamp: new Date().toISOString(),
  });
}

export function notifyOpDeleted(op, actor) {
  const url = process.env.DISCORD_WEBHOOK_OPS;
  return send(url, {
    title: `✖ Opération annulée — ${op.name}`,
    color: COLOR.red,
    fields: [
      { name: 'Date prévue', value: fmtDate(op.date), inline: true },
      { name: 'Zone',        value: op.zone || '—',    inline: true },
    ],
    footer: { text: `Annulée par ${actor || '—'}` },
    timestamp: new Date().toISOString(),
  });
}

// =====================================================================
// ABSENCES
// =====================================================================
export function notifyAbsenceCreated(abs, operatorName, declaredByName) {
  const url = process.env.DISCORD_WEBHOOK_ABSENCES;
  const sameDay = abs.from === abs.to;
  return send(url, {
    title: `🟡 Absence déclarée — ${operatorName}`,
    color: COLOR.amber,
    fields: [
      { name: 'Période', value: sameDay ? fmtDay(abs.from) : `${fmtDay(abs.from)} → ${fmtDay(abs.to)}`, inline: false },
      { name: 'Motif',   value: abs.reason || '—', inline: true },
      ...(abs.comment ? [{ name: 'Commentaire', value: abs.comment.slice(0, 1024) }] : []),
    ],
    footer: { text: `Déclarée par ${declaredByName || '—'}` },
    timestamp: new Date().toISOString(),
  });
}

export function notifyAbsenceDeleted(abs, operatorName, actorName) {
  const url = process.env.DISCORD_WEBHOOK_ABSENCES;
  return send(url, {
    title: `↩ Absence retirée — ${operatorName}`,
    color: COLOR.steel,
    fields: [
      { name: 'Période', value: `${fmtDay(abs.from)} → ${fmtDay(abs.to)}`, inline: false },
      { name: 'Motif',   value: abs.reason || '—', inline: true },
    ],
    footer: { text: `Retirée par ${actorName || '—'}` },
    timestamp: new Date().toISOString(),
  });
}

export function notifyAbsenceEnded(abs, operatorName) {
  const url = process.env.DISCORD_WEBHOOK_ABSENCES;
  return send(url, {
    title: `✅ Fin d'absence — ${operatorName}`,
    color: COLOR.green,
    fields: [
      { name: 'Période', value: `${fmtDay(abs.from)} → ${fmtDay(abs.to)}`, inline: false },
      { name: 'Motif',   value: abs.reason || '—', inline: true },
      { name: 'Statut',  value: 'Retour de l\'opérateur en service', inline: true },
    ],
    timestamp: new Date().toISOString(),
  });
}
