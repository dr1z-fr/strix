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
  notifyFormationCreated, notifyFormationCancelled, notifyFormationValidated,
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
  notes: o.notes || '',
});
const doc2cam = d => ({
  id: d.id, title: d.title, category: d.category || '',
  content: d.content, createdBy: d.created_by,
  createdAt: new Date(d.created_at).getTime(),
  updatedAt: new Date(d.updated_at).getTime(),
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
const cert2cam = c => ({
  id: c.id, code: c.code, name: c.name, description: c.description,
  trainers: c.trainers || [],
  createdAt: new Date(c.created_at).getTime(),
});
const formation2cam = f => ({
  id: f.id, certId: f.cert_id, title: f.title, date: f.date.toISOString(),
  location: f.location, description: f.description,
  attendees: f.attendees || {},
  validated: f.validated, validatedBy: f.validated_by,
  validatedAt: f.validated_at ? new Date(f.validated_at).getTime() : null,
  createdBy: f.created_by, createdAt: new Date(f.created_at).getTime(),
});
const holder2cam = h => ({
  certId: h.cert_id, userId: h.user_id,
  awardedAt: new Date(h.awarded_at).getTime(),
  awardedBy: h.awarded_by, formationId: h.formation_id,
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
  bio: u.bio || '',
  joinedAt: u.joined_at
    ? (u.joined_at instanceof Date
        ? u.joined_at.toISOString().slice(0, 10)
        : String(u.joined_at).slice(0, 10))
    : null,
  primarySpec: u.primary_spec || '',
});
const sanction2cam = s => ({
  id: s.id, userId: s.user_id, type: s.type, reason: s.reason,
  issuedBy: s.issued_by, issuedAt: new Date(s.issued_at).getTime(),
});
// ---- Permission helpers (server-authoritative) ----
const isCmd        = me => me.role === 'cmd';
const canManageOps = me => isCmd(me) || !!me.canManageOps;
const canManageCerts = me => (GRADE_TIERS[me.grade] || 99) <= 6;
const canViewDossier = me => (GRADE_TIERS[me.grade] || 99) <= 5; // Lt et +

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

    // ===== Mandatory password change gate =====
    // Si l'utilisateur doit changer son mot de passe, on n'autorise que :
    //   - 'init'                : pour pouvoir charger l'UI
    //   - 'auth.changePassword' : pour changer effectivement le mdp
    // Toute autre action est refusée tant que le flag n'est pas levé.
    if (me.must_change_password && action !== 'init' && action !== 'auth.changePassword') {
      return res.status(403).json({ error: 'must_change_password' });
    }

    // ===== INIT (single roundtrip — hot cache for the whole session) =====
    if (action === 'init') {
      // Helper : retourne { rows: [] } si la table n'existe pas encore (avant migration).
      const safe = (q) => db.query(q).catch(err => {
        if (err && (err.code === '42P01' /* relation missing */ || err.code === '42703' /* column missing */)) {
          console.warn('[api/db] init: table/column manquante, ignorée —', err.message);
          return { rows: [] };
        }
        throw err;
      });
      const [users, ops, absences, specs, trainings, certs, formations, holders, log, docs, sanctions] = await Promise.all([
        safe('SELECT * FROM users ORDER BY id'),
        safe('SELECT * FROM ops ORDER BY date'),
        safe('SELECT * FROM absences ORDER BY ts DESC'),
        safe('SELECT * FROM specializations ORDER BY name'),
        safe('SELECT * FROM trainings ORDER BY date DESC'),
        safe('SELECT * FROM certifications ORDER BY code'),
        safe('SELECT * FROM formations ORDER BY date DESC'),
        safe('SELECT * FROM cert_holders ORDER BY awarded_at DESC'),
        safe('SELECT * FROM log ORDER BY ts DESC LIMIT 50'),
        safe('SELECT * FROM documents ORDER BY updated_at DESC'),
        safe('SELECT * FROM sanctions ORDER BY issued_at DESC'),
      ]);
      return res.json({
        me: meCam,
        users: users.rows.map(user2cam),
        ops: ops.rows.map(op2cam),
        documents: docs.rows.map(doc2cam),
        sanctions: sanctions.rows.map(sanction2cam),
        absences: absences.rows.map(abs2cam),
        specializations: specs.rows.map(spec2cam),
        trainings: trainings.rows.map(train2cam),
        certifications: certs.rows.map(cert2cam),
        formations: formations.rows.map(formation2cam),
        certHolders: holders.rows.map(holder2cam),
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
        await client.query(`UPDATE formations SET attendees = attendees - $1::text`, [body.id]);
        await client.query(
          `UPDATE certifications
             SET trainers = COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements_text(trainers) x WHERE x <> $1), '[]'::jsonb)`,
          [body.id]
        );
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
        `INSERT INTO ops (id, name, date, zone, priority, brief, created_by, presences, validated, validated_by, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [r.id, r.name, r.date, r.zone, r.priority, r.brief, meCam.id,
         JSON.stringify(r.presences || {}), false, null, r.notes || null]
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

      // 3. Notes du gérant d'op — réservé aux managers.
      if (patch.notes !== undefined) {
        if (!canManageOps(meCam)) return res.status(403).json({ error: 'forbidden_notes' });
        fields.push(`notes = $${i++}`); values.push(patch.notes || null);
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
      const { rows: trRows } = await db.query('SELECT * FROM trainings WHERE id = $1', [body.id]);
      const tr = trRows[0];
      if (!tr) return res.status(404).json({ error: 'not_found' });
      const spec = await getSpec(tr.spec_id);
      const r = body.patch || {};
      const isSpecMember = spec && (
        (spec.members || []).includes(meCam.id) ||
        spec.lead_id === meCam.id ||
        spec.adj_id === meCam.id
      );
      const isMgr = isSpecManagerOf(spec);

      if (r.attendees !== undefined) {
        const prev = Array.isArray(tr.attendees) ? tr.attendees : [];
        const next = Array.isArray(r.attendees)  ? r.attendees  : [];
        const prevSet = new Set(prev);
        const nextSet = new Set(next);
        const changed = [];
        for (const x of prevSet) if (!nextSet.has(x)) changed.push(x);
        for (const x of nextSet) if (!prevSet.has(x)) changed.push(x);
        const onlySelf = changed.length === 1 && changed[0] === meCam.id;
        // Self-toggle uniquement si l'appelant est membre/lead/adj de la spé.
        // Sinon il faut être manager.
        if (!isMgr && !(onlySelf && isSpecMember)) {
          return res.status(403).json({ error: 'forbidden_roster' });
        }
      }
      // Tout autre champ → manager only (titre/date/description… si jamais ajouté plus tard).
      const otherKeys = Object.keys(r).filter(k => k !== 'attendees');
      if (otherKeys.length && !isMgr) {
        return res.status(403).json({ error: 'forbidden' });
      }

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

    // ===========================================================
    //  CERTIFICATIONS
    // ===========================================================
    const isTrainerOf = (cert) => {
      if (!cert) return false;
      if (isCmd(meCam)) return true;
      const list = Array.isArray(cert.trainers) ? cert.trainers : [];
      return list.includes(meCam.id);
    };
    const loadCert = async (id) => {
      const { rows } = await db.query('SELECT * FROM certifications WHERE id = $1', [id]);
      return rows[0] || null;
    };
    const loadFormation = async (id) => {
      const { rows } = await db.query('SELECT * FROM formations WHERE id = $1', [id]);
      return rows[0] || null;
    };

    if (action === 'certs.insert') {
      if (!canManageCerts(meCam)) return res.status(403).json({ error: 'forbidden' });
      const r = body.record;
      if (!r?.id || !r?.code || !r?.name) return res.status(400).json({ error: 'invalid_record' });
      await db.query(
        `INSERT INTO certifications (id, code, name, description, trainers)
         VALUES ($1,$2,$3,$4,$5)`,
        [r.id, r.code, r.name, r.description || null, JSON.stringify(r.trainers || [])]
      );
      return res.json({ ok: true });
    }
    if (action === 'certs.update') {
      if (!canManageCerts(meCam)) return res.status(403).json({ error: 'forbidden' });
      const { id, patch } = body;
      const fields = []; const values = []; let i = 1;
      for (const k of ['code', 'name', 'description']) {
        if (patch[k] !== undefined) { fields.push(`${k} = $${i++}`); values.push(patch[k]); }
      }
      if (patch.trainers !== undefined) {
        fields.push(`trainers = $${i++}::jsonb`);
        values.push(JSON.stringify(Array.isArray(patch.trainers) ? patch.trainers : []));
      }
      if (!fields.length) return res.json({ ok: true });
      values.push(id);
      await db.query(`UPDATE certifications SET ${fields.join(', ')} WHERE id = $${i}`, values);
      return res.json({ ok: true });
    }
    if (action === 'certs.delete') {
      if (!canManageCerts(meCam)) return res.status(403).json({ error: 'forbidden' });
      // ON DELETE CASCADE handles formations + cert_holders
      await db.query('DELETE FROM certifications WHERE id = $1', [body.id]);
      return res.json({ ok: true });
    }

    // Revoke a certification from a holder (manual override by CMD)
    if (action === 'certs.revoke') {
      if (!canManageCerts(meCam)) return res.status(403).json({ error: 'forbidden' });
      const { certId, userId } = body;
      await db.query(
        'DELETE FROM cert_holders WHERE cert_id = $1 AND user_id = $2',
        [certId, userId]
      );
      return res.json({ ok: true });
    }

    // ===========================================================
    //  FORMATIONS
    // ===========================================================
    if (action === 'formations.insert') {
      const r = body.record;
      if (!r?.id || !r?.certId || !r?.title || !r?.date) {
        return res.status(400).json({ error: 'invalid_record' });
      }
      const cert = await loadCert(r.certId);
      if (!cert) return res.status(404).json({ error: 'not_found' });
      if (!isTrainerOf(cert)) return res.status(403).json({ error: 'forbidden_not_trainer' });
      await db.query(
        `INSERT INTO formations (id, cert_id, title, date, location, description, attendees, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [r.id, r.certId, r.title, r.date, r.location || null, r.description || null,
         JSON.stringify(r.attendees || {}), meCam.id]
      );
      await notifyFormationCreated(r, cert.code, cert.name, meCam.name);
      return res.json({ ok: true });
    }

    if (action === 'formations.update') {
      const { id, patch } = body;
      const f = await loadFormation(id);
      if (!f) return res.status(404).json({ error: 'not_found' });
      const cert = await loadCert(f.cert_id);

      // Self-toggle attendance shortcut: anyone can toggle THEIR OWN attendance
      // as long as the formation isn't yet validated.
      if (patch.attendees !== undefined) {
        const prev = f.attendees || {};
        const next = patch.attendees || {};
        if (f.validated && !isTrainerOf(cert)) {
          return res.status(403).json({ error: 'formation_locked' });
        }
        const changed = [];
        const allKeys = new Set([...Object.keys(prev), ...Object.keys(next)]);
        for (const k of allKeys) if (!!prev[k] !== !!next[k]) changed.push(k);
        const onlySelf = changed.length === 1 && changed[0] === meCam.id;
        if (!onlySelf && !isTrainerOf(cert)) {
          return res.status(403).json({ error: 'forbidden_roster' });
        }
        await db.query(
          `UPDATE formations SET attendees = $1::jsonb WHERE id = $2`,
          [JSON.stringify(next), id]
        );
      }

      // Validation/de-validation: trainers of the cert only.
      // On VALIDATION: award the certification to every attendee marked TRUE.
      if (patch.validated !== undefined) {
        if (!isTrainerOf(cert)) return res.status(403).json({ error: 'forbidden_not_trainer' });

        if (!!patch.validated && !f.validated) {
          // Read the LATEST attendees (may have just been patched above)
          const fresh = await loadFormation(id);
          const att = fresh.attendees || {};
          const presentIds = Object.entries(att).filter(([_, v]) => !!v).map(([k]) => k);

          if (presentIds.length) {
            // Bulk award via UNNEST + ON CONFLICT (idempotent)
            await db.query(
              `INSERT INTO cert_holders (cert_id, user_id, awarded_by, formation_id)
               SELECT $1, unnest($2::text[]), $3, $4
               ON CONFLICT (cert_id, user_id) DO NOTHING`,
              [f.cert_id, presentIds, meCam.id, id]
            );
          }
          await db.query(
            `UPDATE formations
                SET validated = TRUE, validated_by = $1, validated_at = NOW()
              WHERE id = $2`,
            [meCam.id, id]
          );
          // Resolve names for the Discord embed
          const { rows: nameRows } = await db.query(
            'SELECT id, name FROM users WHERE id = ANY($1::text[])', [presentIds]
          );
          const namesById = Object.fromEntries(nameRows.map(r => [r.id, r.name]));
          const certifiedNames = presentIds.map(uid => namesById[uid] || uid);
          await notifyFormationValidated(
            { ...f, ...(patch.title !== undefined ? { title: patch.title } : {}) },
            cert.code, cert.name, certifiedNames, meCam.name
          );
        } else if (!patch.validated && f.validated) {
          // De-validation: revoke the certifications that were granted by THIS formation
          await db.query('DELETE FROM cert_holders WHERE formation_id = $1', [id]);
          await db.query(
            `UPDATE formations SET validated = FALSE, validated_by = NULL, validated_at = NULL
              WHERE id = $1`, [id]
          );
        }
      }

      // Trainers can edit meta fields too
      if (patch.title !== undefined || patch.location !== undefined ||
          patch.description !== undefined || patch.date !== undefined) {
        if (!isTrainerOf(cert)) return res.status(403).json({ error: 'forbidden_not_trainer' });
        const fields = []; const values = []; let i = 1;
        for (const k of ['title', 'location', 'description']) {
          if (patch[k] !== undefined) { fields.push(`${k} = $${i++}`); values.push(patch[k]); }
        }
        if (patch.date !== undefined) { fields.push(`date = $${i++}`); values.push(patch.date); }
        if (fields.length) {
          values.push(id);
          await db.query(`UPDATE formations SET ${fields.join(', ')} WHERE id = $${i}`, values);
        }
      }

      return res.json({ ok: true });
    }

    if (action === 'formations.delete') {
      const f = await loadFormation(body.id);
      if (!f) return res.status(404).json({ error: 'not_found' });
      const cert = await loadCert(f.cert_id);
      // Trainer of the cert OR creator of the formation OR cmd
      if (!isTrainerOf(cert) && f.created_by !== meCam.id) {
        return res.status(403).json({ error: 'forbidden' });
      }
      await db.query('DELETE FROM formations WHERE id = $1', [body.id]);
      await notifyFormationCancelled(
        { ...f, date: f.date.toISOString() },
        cert?.code || '?', meCam.name
      );
      return res.json({ ok: true });
    }

    // ===== LOG (rate-limited write, single-statement trim) =====
    if (action === 'log.insert') {
      const r = body.record || {};
      // Validation : le log reflète des actions métier, on ne tolère pas de payload arbitraire.
      const ALLOWED_PILLS = new Set([
        'INFO','AUTH','ADM',
        'OPS','PRES','ROST','VAL',
        'ABS',
        'SPEC','TRAIN',
        'CERT','FORM',
        'DOC',
        'DOS','SAN'
      ]);
      const pill = ALLOWED_PILLS.has(String(r.pill || '').toUpperCase()) ? String(r.pill).toUpperCase() : 'INFO';
      const text = String(r.text || '').slice(0, 280); // tronqué à 280 chars max
      if (!text) return res.status(400).json({ error: 'empty_text' });
      // Single-statement INSERT + trim using a CTE → 1 round-trip instead of 2.
      await db.query(
        `WITH ins AS (
           INSERT INTO log (ts, text, pill, who)
           VALUES (to_timestamp($1 / 1000.0), $2, $3, $4)
           RETURNING id
         )
         DELETE FROM log
         WHERE id NOT IN (SELECT id FROM log ORDER BY ts DESC LIMIT 50)`,
        [r.ts || Date.now(), text, pill, meCam.id]
      );
      return res.json({ ok: true });
    }

    // ===== DOCUMENTS (lecture libre, écriture CMD uniquement) =====
    if (action === 'documents.insert') {
      if (!isCmd(meCam)) return res.status(403).json({ error: 'forbidden' });
      const r = body.record;
      if (!r?.id || !r?.title || !r?.content) return res.status(400).json({ error: 'invalid_record' });
      await db.query(
        `INSERT INTO documents (id, title, category, content, created_by)
         VALUES ($1,$2,$3,$4,$5)`,
        [r.id, r.title, r.category || null, r.content, meCam.id]
      );
      return res.json({ ok: true });
    }
    if (action === 'documents.update') {
      if (!isCmd(meCam)) return res.status(403).json({ error: 'forbidden' });
      const { id, patch } = body;
      const fields = []; const values = []; let i = 1;
      for (const k of ['title', 'category', 'content']) {
        if (patch[k] !== undefined) { fields.push(`${k} = $${i++}`); values.push(patch[k] || null); }
      }
      if (!fields.length) return res.json({ ok: true });
      fields.push(`updated_at = NOW()`);
      values.push(id);
      await db.query(`UPDATE documents SET ${fields.join(', ')} WHERE id = $${i}`, values);
      return res.json({ ok: true });
    }
    if (action === 'documents.delete') {
      if (!isCmd(meCam)) return res.status(403).json({ error: 'forbidden' });
      await db.query('DELETE FROM documents WHERE id = $1', [body.id]);
      return res.json({ ok: true });
    }

    // ===== DOSSIER RP (Lt et +) =====
    if (action === 'dossier.update') {
      if (!canViewDossier(meCam)) return res.status(403).json({ error: 'forbidden' });
      const { id, patch } = body;
      // Cannot edit dossier of someone outranking me (strictly higher)
      const { rows: targetRows } = await db.query('SELECT grade FROM users WHERE id = $1', [id]);
      if (!targetRows[0]) return res.status(404).json({ error: 'not_found' });
      if (id !== meCam.id && outranksMe(targetRows[0].grade)) {
        return res.status(403).json({ error: 'forbidden_higher_rank' });
      }
      const fields = []; const values = []; let i = 1;
      if (patch.bio !== undefined)         { fields.push(`bio = $${i++}`);          values.push(patch.bio || null); }
      if (patch.joinedAt !== undefined)    { fields.push(`joined_at = $${i++}`);    values.push(patch.joinedAt || null); }
      if (patch.primarySpec !== undefined) { fields.push(`primary_spec = $${i++}`); values.push(patch.primarySpec || null); }
      if (!fields.length) return res.json({ ok: true });
      values.push(id);
      await db.query(`UPDATE users SET ${fields.join(', ')} WHERE id = $${i}`, values);
      return res.json({ ok: true });
    }

    // ===== SANCTIONS (Lt et +) =====
    if (action === 'sanctions.insert') {
      if (!canViewDossier(meCam)) return res.status(403).json({ error: 'forbidden' });
      const r = body.record;
      if (!r?.id || !r?.userId || !r?.type || !r?.reason) {
        return res.status(400).json({ error: 'invalid_record' });
      }
      const { rows: tRows } = await db.query('SELECT grade FROM users WHERE id = $1', [r.userId]);
      if (!tRows[0]) return res.status(404).json({ error: 'not_found' });
      if (outranksMe(tRows[0].grade)) {
        return res.status(403).json({ error: 'forbidden_higher_rank' });
      }
      await db.query(
        `INSERT INTO sanctions (id, user_id, type, reason, issued_by)
         VALUES ($1,$2,$3,$4,$5)`,
        [r.id, r.userId, r.type, r.reason, meCam.id]
      );
      return res.json({ ok: true });
    }
    if (action === 'sanctions.delete') {
      if (!canViewDossier(meCam)) return res.status(403).json({ error: 'forbidden' });
      // Refuser la suppression d'une sanction visant un supérieur hiérarchique.
      const { rows: sRows } = await db.query(
        `SELECT s.user_id, u.grade FROM sanctions s
           LEFT JOIN users u ON u.id = s.user_id
          WHERE s.id = $1`, [body.id]
      );
      if (!sRows[0]) return res.status(404).json({ error: 'not_found' });
      if (sRows[0].grade && outranksMe(sRows[0].grade)) {
        return res.status(403).json({ error: 'forbidden_higher_rank' });
      }
      await db.query('DELETE FROM sanctions WHERE id = $1', [body.id]);
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'unknown_action', action });
  } catch (err) {
    console.error('[api/db]', err);
    return res.status(500).json({ error: 'server_error', message: err.message });
  }
}
