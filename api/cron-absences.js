/* =========================================================
   STRIX // Cron daily — notify ended absences
   Scheduled by Vercel (vercel.json crons).
   ========================================================= */
import pg from 'pg';
import { notifyAbsenceEnded } from './_discord.js';

const { Pool } = pg;
let pool;
function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 2,
    });
  }
  return pool;
}

export default async function handler(req, res) {
  // Vercel Cron sends Authorization: Bearer <CRON_SECRET>
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'unauthorized' });
    }
  }

  const db = getPool();
  try {
    // Atomic: select + mark notified in one round-trip
    const { rows } = await db.query(
      `UPDATE absences a
         SET end_notified = TRUE
       FROM users u
       WHERE a.operator = u.id
         AND a.end_notified = FALSE
         AND a.to_date < CURRENT_DATE
       RETURNING a.id, a.from_date, a.to_date, a.reason, u.name AS operator_name, a.operator`
    );

    // Fire-and-forget Discord notifications
    await Promise.all(rows.map(r => notifyAbsenceEnded({
      from: r.from_date instanceof Date ? r.from_date.toISOString().slice(0, 10) : String(r.from_date).slice(0, 10),
      to:   r.to_date   instanceof Date ? r.to_date.toISOString().slice(0, 10)   : String(r.to_date).slice(0, 10),
      reason: r.reason,
    }, r.operator_name || r.operator)));

    return res.json({ ok: true, notified: rows.length });
  } catch (err) {
    console.error('[cron-absences]', err);
    return res.status(500).json({ error: 'server_error', message: err.message });
  }
}
