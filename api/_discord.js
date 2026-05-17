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

async function send(webhookUrl, embed, opts = {}) {
  if (!webhookUrl) {
    console.warn('[discord] no webhook url configured — skip');
    return;
  }
  const url = webhookUrl.trim();
  if (!/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(url)) {
    console.error('[discord] invalid webhook URL format:', url.slice(0, 60));
    return;
  }
  const payload = {
    username: 'STRIX Command',
    embeds: [embed],
  };
  if (opts.pingRoleId) {
    payload.content = `<@&${opts.pingRoleId}>`;
    payload.allowed_mentions = { parse: [], roles: [opts.pingRoleId] };
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.error(`[discord] HTTP ${res.status}:`, txt.slice(0, 200));
    } else {
      console.log('[discord] embed sent OK');
    }
  } catch (err) {
    console.error('[discord] post failed:', err.message, '| cause:', err.cause?.code || err.cause?.message || err.cause);
  }
}

// =====================================================================
// OPERATIONS
// =====================================================================
const OPS_PING_ROLE = process.env.DISCORD_OPS_PING_ROLE_ID || '1432712716589465763';

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
  }, { pingRoleId: OPS_PING_ROLE });
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
  }, { pingRoleId: OPS_PING_ROLE });
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

// =====================================================================
// FORMATIONS
// =====================================================================
const FORMATIONS_PING_ROLE = process.env.DISCORD_FORMATIONS_PING_ROLE_ID || '';

export function notifyFormationCreated(f, certCode, certName, trainerName) {
  const url = process.env.DISCORD_WEBHOOK_FORMATIONS;
  return send(url, {
    title: `📚 Nouvelle formation — ${f.title}`,
    color: COLOR.steel,
    fields: [
      { name: 'Certification', value: `**${certCode}** — ${certName}`, inline: false },
      { name: 'Date',          value: fmtDate(f.date), inline: true },
      { name: 'Lieu',          value: f.location || '—', inline: true },
      ...(f.description ? [{ name: 'Programme', value: f.description.slice(0, 1024) }] : []),
    ],
    footer: { text: `Formateur · ${trainerName || '—'}` },
    timestamp: new Date().toISOString(),
  }, FORMATIONS_PING_ROLE ? { pingRoleId: FORMATIONS_PING_ROLE } : {});
}

export function notifyFormationCancelled(f, certCode, actorName) {
  const url = process.env.DISCORD_WEBHOOK_FORMATIONS;
  return send(url, {
    title: `✖ Formation annulée — ${f.title}`,
    color: COLOR.red,
    fields: [
      { name: 'Certification', value: certCode, inline: true },
      { name: 'Date prévue',   value: fmtDate(f.date), inline: true },
    ],
    footer: { text: `Annulée par ${actorName || '—'}` },
    timestamp: new Date().toISOString(),
  });
}

export function notifyFormationValidated(f, certCode, certName, certifiedNames, trainerName) {
  const url = process.env.DISCORD_WEBHOOK_FORMATIONS;
  const list = certifiedNames.length
    ? certifiedNames.map(n => `• ${n}`).join('\n').slice(0, 1024)
    : '_aucun opérateur certifié_';
  return send(url, {
    title: `🎖 Formation validée — ${certCode}`,
    color: COLOR.green,
    fields: [
      { name: 'Session',       value: f.title, inline: false },
      { name: 'Certification', value: `**${certCode}** — ${certName}`, inline: false },
      { name: `Opérateurs certifiés (${certifiedNames.length})`, value: list, inline: false },
    ],
    footer: { text: `Validée par ${trainerName || '—'}` },
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
