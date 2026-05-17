/* =========================================================
   STRIX // API DB — Vercel Serverless (single dispatcher)
   Hardened permission checks + free-tier optimised.
   ========================================================= */
import pg from 'pg';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import {
  notifyOpCreated, notifyOpDeleted,
  notifyAbsenceCreated, notifyAbsenceDeleted,
} from './_discord.js';

const { Pool } = pg;

let pool;
function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 3,
    });
  }
  return pool;
}

const SECRET = process.env.SESSION_SECRET || 'change-me-please';
const TOKEN_TTL_MS = 7 * 24 * 3600 * 1000; // 7 jours (compromis sécu/UX)

// Tier <= 8 (Sergent et + haut) reçoit canManageOps par défaut.
const OPS_PERM_DEFAULT_TIER = 8;
const GRADE_TIERS = {
  'colonel': 1, 'lt-colonel': 2, 'commandant': 3,
  'capitaine': 4, 'lieutenant': 5,
  'major': 6, 'adjudant': 7, 'sergent': 8,
  'caporal': 9, 'operateur-1cl': 10, 'operateur-2cl': 11, 'recrue': 12,
};
const ROLE_BY_TIER = (tier) =>
  tier <= 3 ? 'cmd' : tier <= 8 ? 'lead' : 'op';
const defaultCanManageOps = (gradeKey) => (GRADE_TIERS[gradeKey] || 99) <= OPS_PERM_DEFAULT_TIER;
const roleFromGrade = (gradeKey) => ROLE_BY_TIER(GRADE_TIERS[gradeKey] || 99);

// ---- Token helpers (HMAC signed) ----
function sign(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}
function verify(token) {
  if (!token || typeof token !== 'string') return null;
  const [data, sig] = token.split('.');
  if (!data || !sig) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  // Constant-time compare
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

// ---- Bootstrap default Colonel "Drui" ----
async function bootstrapIfEmpty(db) {
  const { rows } = await db.query('SELECT count(*)::int AS c FROM users');
  if (rows[0].c === 0) {
    const hash = await bcrypt.hash('strix2025', 10);
    await db.query(
      `INSERT INTO users (id, password_hash, name, grade, role, status, can_manage_ops, must_change_password)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      ['Drui', hash, 'Drui', 'colonel', 'cmd', 'actif', true, true]
    );
    return true;
  }
  return false;
}

// ---- Camelizers (snake_case → camelCase) ----
const op2cam = o => ({
  id: o.id, name: o.name, date: o.date.toISOString(), zone: o.zone,
  priority: o.priority, brief: o.brief, createdBy: o.created_by,
  presences: o.presences || {},
  validated: o.validated, validatedBy: o.validated_by,
});
const abs2cam = a => ({
  id: a.id, operator: a.operator,
  from: a.from_date instanceof Date ? a.from_date.toISOString().slice(0, 10) : String(a.from_date).slice(0, 10),
  to:   a.to_date   instanceof Date ? a.to_date.toISOString().slice(0, 10)   : String(a.to_date).slice(0, 10),
  reason: a.reason, comment: a.comment, declaredBy: a.declared_by,
  ts: new Date(a.ts).getTime(),
});
const spec2cam = s => ({
  id: s.id, name: s.name, description: s.description,
  leadId: s.lead_id, adjId: s.adj_id, members: s.members || [],
  createdAt: new Date(s.created_at).getTime(),
});
const train2cam = t => ({
  id: t.id, specId: t.spec_id, title: t.title, date: t.date.toISOString(),
  description: t.description, attendees: t.attendees || [],
  createdBy: t.created_by, createdAt: new Date(t.created_at).getTime(),
});
const log2cam = l => ({
  id: String(l.id), ts: new Date(l.ts).getTime(),
  text: l.text, pill: l.pill, who: l.who,
});
const user2cam = u => ({
  id: u.id, name: u.name, grade: u.grade, role: u.role, status: u.status,
  canManageOps: !!u.can_manage_ops,
  mustChangePassword: !!u.must_change_password,
});

// ---- Permission helpers (server-authoritative) ----
const isCmd        = me => me.role === 'cmd';
const canManageOps = me => isCmd(me) || !!me.canManageOps;

// ---- Main handler ----
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const db = getPool();
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};
  const { action } = body;

  try {
    // ===== LOGIN (no auth) =====
    if (action === 'login') {
      const { id, password } = body;
      if (!id || !password) return res.status(400).json({ error: 'missing_fields' });
      await bootstrapIfEmpty(db);
      const { rows } = await db.query(
        `SELECT id, password_hash, name, grade, role, status, can_manage_ops, must_change_password
         FROM users WHERE id = $1`, [id]
      );
      const u = rows[0];
      if (!u || !(await bcrypt.compare(password, u.password_hash))) {
        return res.status(401).json({ error: 'invalid_credentials' });
      }
      if (u.status === 'reserve') return res.status(403).json({ error: 'reserve' });
      // Token contains all the security-relevant claims; verified each request.
      const token = sign({
        uid: u.id,
        role: u.role,
        canManageOps: !!u.can_manage_ops,
        exp: Date.now() + TOKEN_TTL_MS,
      });
      // Fire-and-forget log entry (non-blocking) — keep latency low.
      db.query(
        `WITH ins AS (INSERT INTO log (text, pill, who) VALUES ($1, $2, $3) RETURNING id)
         DELETE FROM log WHERE id NOT IN (SELECT id FROM log ORDER BY ts DESC LIMIT 50)`,
        [`Connexion — ${u.name}`, 'AUTH', u.id]
      ).catch(() => {});
      return res.json({ token, user: user2cam(u) });
    }

    // ===== AUTH WALL =====
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const session = verify(token);
    if (!session) return res.status(401).json({ error: 'unauthorized' });

    // Re-validate against DB (status, role drift) using ONE small indexed query.
    // This costs ~1 ms per request but prevents stale-token privilege escalation.
    const { rows: meRows } = await db.query(
      `SELECT id, name, grade, role, status, can_manage_ops, must_change_password FROM users WHERE id = $1`,
      [session.uid]
    );
    const me = meRows[0];
    if (!me || me.status === 'reserve') return res.status(401).json({ error: 'session_invalid' });
    const meCam = user2cam(me);

    // ===== INIT (single roundtrip — hot cache for the whole session) =====
    if (action === 'init') {
      const [users, ops, absences, specs, trainings, log] = await Promise.all([
        db.query('SELECT id, name, grade, role, status, can_manage_ops, must_change_password FROM users ORDER BY id'),
        db.query('SELECT * FROM ops ORDER BY date'),
        db.query('SELECT * FROM absences ORDER BY ts DESC'),
        db.query('SELECT * FROM specializations ORDER BY name'),
        db.query('SELECT * FROM trainings ORDER BY date DESC'),
        db.query('SELECT * FROM log ORDER BY ts DESC LIMIT 50'),
      ]);
      return res.json({
        me: meCam,
        users: users.rows.map(user2cam),
        ops: ops.rows.map(op2cam),
        absences: absences.rows.map(abs2cam),
        specializations: specs.rows.map(spec2cam),
        trainings: trainings.rows.map(train2cam),
        log: log.rows.map(log2cam),
      });
    }

    // ===== AUTH — change own password (clears must_change_password flag) =====
    if (action === 'auth.changePassword') {
      const { password } = body;
      if (!password || password.length < 4) return res.status(400).json({ error: 'password_too_short' });
      const hash = await bcrypt.hash(password, 10);
      await db.query(
        `UPDATE users SET password_hash = $1, must_change_password = false WHERE id = $2`,
        [hash, meCam.id]
      );
      return res.json({ ok: true });
    }

    // Hierarchy helpers — tier 1 = highest. "Strictement supérieur" = tier <.
    const meTier = GRADE_TIERS[me.grade] || 99;
    const tierOf = (gradeKey) => GRADE_TIERS[gradeKey] || 99;
    const outranksMe = (targetGrade) => tierOf(targetGrade) < meTier;

    // ===== USERS (CMD only) =====
    if (action === 'users.insert') {
      if (!isCmd(meCam)) return res.status(403).json({ error: 'forbidden' });
      const r = body.record;
      if (!r?.id || !r?.name || !r?.grade) return res.status(400).json({ error: 'invalid_record' });
      if (outranksMe(r.grade)) return res.status(403).json({ error: 'forbidden_higher_rank' });
      const role = roleFromGrade(r.grade);
      const cmo  = r.canManageOps !== undefined ? !!r.canManageOps : defaultCanManageOps(r.grade);
      const hash = await bcrypt.hash(r.password || 'changeme', 10);
      await db.query(
        `INSERT INTO users (id, password_hash, name, grade, role, status, can_manage_ops, must_change_password)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true)`,
        [r.id, hash, r.name, r.grade, role, r.status || 'actif', cmo]
      );
      return res.json({ ok: true });
    }
    if (action === 'users.update') {
      if (!isCmd(meCam)) return res.status(403).json({ error: 'forbidden' });
      const { id, patch } = body;
      // Load target to check rank hierarchy
      const { rows: tgtRows } = await db.query('SELECT grade FROM users WHERE id = $1', [id]);
      const target = tgtRows[0];
      if (!target) return res.status(404).json({ error: 'not_found' });
      // Cannot modify someone outranking you (unless it's yourself).
      if (id !== meCam.id && outranksMe(target.grade)) {
        return res.status(403).json({ error: 'forbidden_higher_rank' });
      }
      // Cannot promote anyone to a grade outranking you.
      if (patch.grade !== undefined && outranksMe(patch.grade)) {
        return res.status(403).json({ error: 'forbidden_higher_rank' });
      }
      const fields = []; const values = []; let i = 1;
      for (const k of ['name', 'grade', 'status']) {
        if (patch[k] !== undefined) { fields.push(`${k} = $${i++}`); values.push(patch[k]); }
      }
      if (patch.grade !== undefined) {
        fields.push(`role = $${i++}`); values.push(roleFromGrade(patch.grade));
      }
      if (patch.canManageOps !== undefined) {
        fields.push(`can_manage_ops = $${i++}`); values.push(!!patch.canManageOps);
      }
      if (patch.password) {
        const h = await bcrypt.hash(patch.password, 10);
        fields.push(`password_hash = $${i++}`); values.push(h);
        // Admin-forced password reset → target must change it on next login
        // (unless admin resets their own password via this path)
        if (id !== meCam.id) {
          fields.push(`must_change_password = $${i++}`); values.push(true);
        } else {
          fields.push(`must_change_password = $${i++}`); values.push(false);
        }
      }
      values.push(id);
      if (fields.length) await db.query(`UPDATE users SET ${fields.join(', ')} WHERE id = $${i}`, values);
      return res.json({ ok: true });
    }
    if (action === 'users.delete') {
      if (!isCmd(meCam)) return res.status(403).json({ error: 'forbidden' });
      if (body.id === meCam.id) return res.status(400).json({ error: 'cannot_delete_self' });
      const { rows: tgtRows } = await db.query('SELECT grade FROM users WHERE id = $1', [body.id]);
      const target = tgtRows[0];
      if (target && outranksMe(target.grade)) {
        return res.status(403).json({ error: 'forbidden_higher_rank' });
      }
      // Atomic cleanup in a single transaction (frees the client from doing it)
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM users WHERE id = $1', [body.id]);
        await client.query(
          `UPDATE specializations
             SET members = COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements_text(members) x WHERE x <> $1), '[]'::jsonb)`,
          [body.id]
        );
        await client.query(
          `UPDATE trainings
             SET attendees = COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements_text(attendees) x WHERE x <> $1), '[]'::jsonb)`,
          [body.id]
        );
        await client.query(`UPDATE ops SET presences = presences - $1::text`, [body.id]);
        await client.query('COMMIT');
      } catch (e) { await client.query('ROLLBACK'); throw e; }
      finally { client.release(); }
      return res.json({ ok: true });
    }

    // ===== OPS =====
    if (action === 'ops.insert') {
      if (!canManageOps(meCam)) return res.status(403).json({ error: 'forbidden' });
      const r = body.record;
      await db.query(
        `INSERT INTO ops (id, name, date, zone, priority, brief, created_by, presences, validated, validated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [r.id, r.name, r.date, r.zone, r.priority, r.brief, meCam.id,
         JSON.stringify(r.presences || {}), false, null]
      );
      await notifyOpCreated(r, meCam.name);
      return res.json({ ok: true });
    }
    if (action === 'ops.update') {
      const { id, patch } = body;
      // Load current op to authorise field-by-field changes.
      const { rows } = await db.query('SELECT * FROM ops WHERE id = $1', [id]);
      const op = rows[0];
      if (!op) return res.status(404).json({ error: 'not_found' });

      // Compose the update with strict per-field permission checks.
      const fields = []; const values = []; let i = 1;

      // 1. Toggling validation status — managers only, op cannot be re-validated by nobody.
      if (patch.validated !== undefined) {
        if (!canManageOps(meCam)) return res.status(403).json({ error: 'forbidden_validate' });
        fields.push(`validated = $${i++}`); values.push(!!patch.validated);
        fields.push(`validated_by = $${i++}`); values.push(patch.validated ? meCam.id : null);
      }

      // 2. Updating presences — distinguish self-toggle vs roster change.
      if (patch.presences !== undefined) {
        const prev = op.presences || {};
        const next = patch.presences || {};
        if (op.validated && !canManageOps(meCam)) {
          return res.status(403).json({ error: 'op_locked' });
        }
        // Compute set of changed user-ids
        const allKeys = new Set([...Object.keys(prev), ...Object.keys(next)]);
        const changed = [];
        for (const k of allKeys) {
          if (!!prev[k] !== !!next[k]) changed.push(k);
        }
        // If any changed key is not the requester themself, only managers may apply.
        const onlySelf = changed.length === 1 && changed[0] === meCam.id;
        if (!onlySelf && !canManageOps(meCam)) {
          return res.status(403).json({ error: 'forbidden_roster' });
        }
        fields.push(`presences = $${i++}::jsonb`); values.push(JSON.stringify(next));
      }

      values.push(id);
      if (fields.length) await db.query(`UPDATE ops SET ${fields.join(', ')} WHERE id = $${i}`, values);
      return res.json({ ok: true });
    }
    if (action === 'ops.delete') {
      if (!canManageOps(meCam)) return res.status(403).json({ error: 'forbidden' });
      const { rows: opRows } = await db.query('SELECT id, name, date, zone FROM ops WHERE id = $1', [body.id]);
      const opToDelete = opRows[0];
      await db.query('DELETE FROM ops WHERE id = $1', [body.id]);
      if (opToDelete) await notifyOpDeleted({
        ...opToDelete,
        date: opToDelete.date.toISOString(),
      }, meCam.name);
      return res.json({ ok: true });
    }

    // ===== ABSENCES =====
    if (action === 'absences.insert') {
      const r = body.record;
      if (r.operator !== meCam.id && !canManageOps(meCam)) {
        return res.status(403).json({ error: 'forbidden' });
      }
      await db.query(
        `INSERT INTO absences (id, operator, from_date, to_date, reason, comment, declared_by, ts)
         VALUES ($1,$2,$3,$4,$5,$6,$7, to_timestamp($8 / 1000.0))`,
        [r.id, r.operator, r.from, r.to, r.reason, r.comment, meCam.id, r.ts || Date.now()]
      );
      const { rows: nameRows } = await db.query('SELECT name FROM users WHERE id = $1', [r.operator]);
      await notifyAbsenceCreated(r, nameRows[0]?.name || r.operator, meCam.name);
      return res.json({ ok: true });
    }
    if (action === 'absences.delete') {
      // Only declarer, target operator, or manager may remove.
      const { rows } = await db.query(
        `SELECT a.*, u.name AS operator_name
         FROM absences a LEFT JOIN users u ON u.id = a.operator
         WHERE a.id = $1`, [body.id]
      );
      const a = rows[0];
      if (!a) return res.status(404).json({ error: 'not_found' });
      if (a.declared_by !== meCam.id && a.operator !== meCam.id && !canManageOps(meCam)) {
        return res.status(403).json({ error: 'forbidden' });
      }
      await db.query('DELETE FROM absences WHERE id = $1', [body.id]);
      await notifyAbsenceDeleted({
        from: a.from_date instanceof Date ? a.from_date.toISOString().slice(0, 10) : String(a.from_date).slice(0, 10),
        to:   a.to_date   instanceof Date ? a.to_date.toISOString().slice(0, 10)   : String(a.to_date).slice(0, 10),
        reason: a.reason,
      }, a.operator_name || a.operator, meCam.name);
      return res.json({ ok: true });
    }

    // ===== SPECIALIZATIONS =====
    if (action === 'specs.insert') {
      if (!isCmd(meCam)) return res.status(403).json({ error: 'forbidden' });
      const r = body.record;
      await db.query(
        `INSERT INTO specializations (id, name, description, lead_id, adj_id, members)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [r.id, r.name, r.description, r.leadId || null, r.adjId || null, JSON.stringify(r.members || [])]
      );
      return res.json({ ok: true });
    }
    if (action === 'specs.update') {
      const { id, patch } = body;
      const { rows } = await db.query('SELECT * FROM specializations WHERE id = $1', [id]);
      const spec = rows[0];
      if (!spec) return res.status(404).json({ error: 'not_found' });
      const isSpecManager =
        isCmd(meCam) || spec.lead_id === meCam.id || spec.adj_id === meCam.id;

      // Only CMD may change name/description/leadId/adjId
      if (!isCmd(meCam)) {
        if (patch.name !== undefined || patch.description !== undefined ||
            patch.leadId !== undefined || patch.adjId !== undefined) {
          return res.status(403).json({ error: 'forbidden_meta' });
        }
      }
      // Only spec manager may modify members
      if (patch.members !== undefined && !isSpecManager) {
        return res.status(403).json({ error: 'forbidden_members' });
      }

      const fields = []; const values = []; let i = 1;
      if (patch.name !== undefined)        { fields.push(`name = $${i++}`);            values.push(patch.name); }
      if (patch.description !== undefined) { fields.push(`description = $${i++}`);     values.push(patch.description); }
      if (patch.leadId !== undefined)      { fields.push(`lead_id = $${i++}`);         values.push(patch.leadId); }
      if (patch.adjId !== undefined)       { fields.push(`adj_id = $${i++}`);          values.push(patch.adjId); }
      if (patch.members !== undefined)     { fields.push(`members = $${i++}::jsonb`);  values.push(JSON.stringify(patch.members)); }
      values.push(id);
      if (fields.length) await db.query(`UPDATE specializations SET ${fields.join(', ')} WHERE id = $${i}`, values);
      return res.json({ ok: true });
    }
    if (action === 'specs.delete') {
      if (!isCmd(meCam)) return res.status(403).json({ error: 'forbidden' });
      await db.query('DELETE FROM specializations WHERE id = $1', [body.id]);
      return res.json({ ok: true });
    }

    // ===== TRAININGS (spec manager only) =====
    async function getSpecForTraining(trainingId) {
      const { rows } = await db.query(
        `SELECT s.* FROM trainings t JOIN specializations s ON s.id = t.spec_id WHERE t.id = $1`,
        [trainingId]
      );
      return rows[0] || null;
    }
    async function getSpec(specId) {
      const { rows } = await db.query('SELECT * FROM specializations WHERE id = $1', [specId]);
      return rows[0] || null;
    }
    const isSpecManagerOf = (spec) =>
      spec && (isCmd(meCam) || spec.lead_id === meCam.id || spec.adj_id === meCam.id);

    if (action === 'trainings.insert') {
      const r = body.record;
      const spec = await getSpec(r.specId);
      if (!isSpecManagerOf(spec)) return res.status(403).json({ error: 'forbidden' });
      await db.query(
        `INSERT INTO trainings (id, spec_id, title, date, description, attendees, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [r.id, r.specId, r.title, r.date, r.description,
         JSON.stringify(r.attendees || []), meCam.id]
      );
      return res.json({ ok: true });
    }
    if (action === 'trainings.update') {
      const spec = await getSpecForTraining(body.id);
      if (!isSpecManagerOf(spec)) return res.status(403).json({ error: 'forbidden' });
      const r = body.patch;
      const fields = []; const values = []; let i = 1;
      if (r.attendees !== undefined) { fields.push(`attendees = $${i++}::jsonb`); values.push(JSON.stringify(r.attendees)); }
      values.push(body.id);
      if (fields.length) await db.query(`UPDATE trainings SET ${fields.join(', ')} WHERE id = $${i}`, values);
      return res.json({ ok: true });
    }
    if (action === 'trainings.delete') {
      const spec = await getSpecForTraining(body.id);
      if (!isSpecManagerOf(spec)) return res.status(403).json({ error: 'forbidden' });
      await db.query('DELETE FROM trainings WHERE id = $1', [body.id]);
      return res.json({ ok: true });
    }

    // ===== LOG (rate-limited write, single-statement trim) =====
    if (action === 'log.insert') {
      const r = body.record;
      // Single-statement INSERT + trim using a CTE → 1 round-trip instead of 2.
      await db.query(
        `WITH ins AS (
           INSERT INTO log (ts, text, pill, who)
           VALUES (to_timestamp($1 / 1000.0), $2, $3, $4)
           RETURNING id
         )
         DELETE FROM log
         WHERE id NOT IN (SELECT id FROM log ORDER BY ts DESC LIMIT 50)`,
        [r.ts || Date.now(), r.text || '', r.pill || 'INFO', meCam.id]
      );
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'unknown_action', action });
  } catch (err) {
    console.error('[api/db]', err);
    return res.status(500).json({ error: 'server_error', message: err.message });
  }
}
