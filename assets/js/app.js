/* =========================================================
   STRIX // COMMAND TERMINAL APPLICATION
   ========================================================= */
const db = STRIX.db;

// ---- Auth guard ----
if (!db.auth.isAuthenticated()) {
  window.location.href = 'index.html';
  throw new Error('redirect');
}

// Module-level identity vars — populated by bootstrap() after API init.
let me = null;
let myGrade = null;
let isLeader = false;
let isCmd    = false;

// ---- Helpers ----
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
function initials(name) {
  return name.split(/[\s.]+/).filter(Boolean).map(s => s[0]).join('').slice(0, 2).toUpperCase();
}
function gradeOf(user) { return db.gradeByKey(user && user.grade) || null; }
function userById(id) { return db.users.find(id); }
function fmtDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
    + ' · ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ---- Toast ----
function toast(msg) {
  const stack = $('toastStack');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  stack.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .25s'; }, 2400);
  setTimeout(() => el.remove(), 2700);
}

// ---- Confirm modal ----
function confirmDialog(title, body) {
  return new Promise(resolve => {
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = `
      <div class="modal">
        <header>${title}</header>
        <div class="modal-body">${body}</div>
        <div class="modal-actions">
          <button class="btn-ghost" data-act="no">Annuler</button>
          <button class="btn-primary" data-act="yes">Confirmer</button>
        </div>
      </div>`;
    document.body.appendChild(back);
    back.addEventListener('click', (e) => {
      const act = e.target.dataset.act;
      if (e.target === back || act === 'no') { back.remove(); resolve(false); }
      if (act === 'yes') { back.remove(); resolve(true); }
    });
  });
}

// ---- Logger ----
function logAction(text, pill = 'INFO') {
  if (!me) return;
  db.log.insert({ text, pill, who: me.id });
}

// ---- User panel setup (called from bootstrap, once me is known) ----
function setupUserPanel() {
  $('userName').textContent = `${myGrade.label} ${me.name}`;
  $('userRank').textContent = me.role === 'cmd' ? 'Officier supérieur' : me.role === 'lead' ? 'Officier / S-Off' : 'Militaire du Rang';
  $('userAvatar').textContent = initials(me.name);

  $('logoutBtn').addEventListener('click', async () => {
    if (!await confirmDialog('Déconnexion', 'Confirmer la fin de session ?')) return;
    logAction(`Déconnexion — ${me.name}`, 'AUTH');
    setTimeout(() => { db.auth.logout(); window.location.href = 'index.html'; }, 100);
  });

  if (!isCmd) $('navAdmin').style.display = 'none';
  if (!isLeader) $('opFormPanel').style.display = 'none';
  if (!isCmd) $('specFormPanel').style.display = 'none';
}

// ---- Clock ----
function tickClock() {
  const d = new Date();
  $('clockTime').textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  $('clockDate').textContent = d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}
tickClock(); setInterval(tickClock, 1000);

// ---- Navigation ----
const VIEWS = {
  overview:  { title: 'Tableau de bord',  crumb: 'Overview' },
  ops:       { title: 'Opérations',       crumb: 'Opérations' },
  absences:  { title: 'Absences',         crumb: 'Absences' },
  personnel: { title: 'Personnel',        crumb: 'Personnel' },
  specs:     { title: 'Spécialisations',  crumb: 'Spécialisations' },
  admin:     { title: 'Administration',   crumb: 'Admin' },
};
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    const v = btn.dataset.view;
    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.view').forEach(s => s.classList.toggle('active', s.id === `view-${v}`));
    $('viewTitle').textContent = VIEWS[v].title;
    $('viewCrumb').textContent = VIEWS[v].crumb;
  });
});

// =========================================================
//                       OPERATIONS
// =========================================================
const opForm = $('opForm');

opForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!isLeader) return;
  const op = {
    id: db.uid(),
    name: $('opName').value.trim().toUpperCase(),
    date: new Date($('opDate').value).toISOString(),
    zone: $('opZone').value.trim(),
    priority: $('opPriority').value,
    brief: $('opBrief').value.trim(),
    createdBy: me.id,
    presences: {},
    validated: false,
    validatedBy: null,
  };
  db.ops.insert(op);
  logAction(`Opération créée — ${op.name}`, 'OPS');
  toast(`Opération ${op.name} créée`);
  opForm.reset();
  renderAll();
});

function renderOps() {
  const list = $('opsList');
  const ops = db.ops.all().sort((a, b) => new Date(a.date) - new Date(b.date));
  $('opsCount').textContent = ops.length;

  if (ops.length === 0) {
    list.innerHTML = '<p class="empty-state">Aucune opération programmée.</p>';
    return;
  }

  const totalActive = db.users.where(u => u.status === 'actif').length;

  list.innerHTML = ops.map(op => {
    const myChecked = !!op.presences[me.id];
    const confirmed = Object.keys(op.presences).filter(k => op.presences[k]);
    const pct = totalActive > 0 ? Math.round((confirmed.length / totalActive) * 100) : 0;

    // === ROSTER : éditable pour les leaders (op non validée), readonly sinon ===
    const editableRoster = isLeader && !op.validated;
    let rosterHTML = '';
    if (editableRoster) {
      const activeUsers = db.users.where(u => u.status === 'actif')
        .sort((a, b) => (gradeOf(a)?.tier || 99) - (gradeOf(b)?.tier || 99));
      rosterHTML = activeUsers.length === 0
        ? '<li class="empty-state">Aucun opérateur actif.</li>'
        : activeUsers.map(u => {
            const g = gradeOf(u);
            const checked = !!op.presences[u.id];
            const selfMark = u.id === me.id;
            return `<li class="roster-editable ${checked ? 'is-checked' : ''}">
              <label class="roster-toggle">
                <input type="checkbox" data-roster="${op.id}" data-uid="${u.id}" ${checked ? 'checked' : ''}/>
                <div class="roster-info">
                  <div class="mini-avatar">${initials(u.name)}</div>
                  <div>
                    <div class="op-id">${u.id} <span style="color:var(--dim);font-size:10px">· ${g ? g.short : '—'}</span>${selfMark ? ' <span style="color:var(--dim);font-size:10px">(vous)</span>' : ''}</div>
                    <div class="op-name-small">${u.name}</div>
                  </div>
                </div>
              </label>
              <span class="op-confirm ${checked ? 'confirm-ok' : 'confirm-pending'}">${checked ? 'Présent' : 'Absent'}</span>
            </li>`;
          }).join('');
    } else {
      rosterHTML = confirmed.length === 0
        ? '<li class="empty-state">Aucun opérateur confirmé.</li>'
        : confirmed
            .map(id => ({ id, u: userById(id) }))
            .sort((a, b) => {
              const ga = a.u && gradeOf(a.u); const gb = b.u && gradeOf(b.u);
              return (ga ? ga.tier : 99) - (gb ? gb.tier : 99);
            })
            .map(({ id, u }) => {
              const g = u ? gradeOf(u) : null;
              const cls = op.validated ? 'confirm-ok' : 'confirm-pending';
              const txt = op.validated ? 'Validé' : 'En attente';
              return `<li>
                <div class="roster-info">
                  <div class="mini-avatar">${u ? initials(u.name) : '?'}</div>
                  <div>
                    <div class="op-id">${id} <span style="color:var(--dim);font-size:10px">· ${g ? g.short : '—'}</span></div>
                    <div class="op-name-small">${u ? u.name : '— inconnu —'}</div>
                  </div>
                </div>
                <span class="op-confirm ${cls}">${txt}</span>
              </li>`;
            }).join('');
    }

    const locked = op.validated;
    let actions = '';
    if (isLeader) {
      actions += op.validated
        ? `<button class="btn-danger btn-sm" data-unvalidate="${op.id}">Déverrouiller</button>`
        : `<button class="btn-primary btn-sm" data-validate="${op.id}">Valider · ${confirmed.length}</button>`;
      actions += `<button class="btn-ghost btn-sm" data-delete="${op.id}">Supprimer</button>`;
    }

    const banner = op.validated
      ? `<div class="validation-banner">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 13l4 4L19 7"/></svg>
           Effectifs validés par <strong>${op.validatedBy}</strong> · ${confirmed.length} confirmé(s)
         </div>`
      : '';

    return `
    <article class="op-card ${op.validated ? 'validated' : ''}">
      <header class="op-card-head">
        <div>
          <div class="op-title">${op.name}</div>
          <div class="op-meta-line">
            <span class="meta"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg><strong>${fmtDateTime(op.date)}</strong></span>
            <span class="meta"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg><strong>${op.zone}</strong></span>
            <span class="badge ${op.priority.toLowerCase()}">${op.priority}</span>
          </div>
        </div>
        <div class="op-actions">${actions}</div>
      </header>
      ${op.brief ? `<div class="op-brief"><span>${op.brief}</span></div>` : ''}
      ${banner}
      <div class="op-presence">
        <div class="presence-block">
          <h4>Ma présence <span class="count">${myChecked ? '✓' : ''}</span></h4>
          <div class="presence-self">
            <label class="presence-toggle ${locked ? 'disabled' : ''}">
              <input type="checkbox" data-presence="${op.id}" ${myChecked ? 'checked' : ''} ${locked ? 'disabled' : ''}/>
              <span>${myChecked ? 'Présence confirmée' : 'Cocher pour confirmer la présence'}</span>
            </label>
            ${locked ? '<span class="op-confirm confirm-ok">Verrouillé</span>' : ''}
          </div>
          <div class="presence-bar"><div style="width:${pct}%"></div></div>
          <div style="font-size:11px;color:var(--dim);margin-top:6px;">${confirmed.length} / ${totalActive} opérateurs actifs (${pct}%)</div>
        </div>
        <div class="presence-block">
          <h4>${editableRoster ? 'Sélection des effectifs' : 'Effectifs'} <span class="count">${confirmed.length}</span></h4>
          ${editableRoster ? '<div style="font-size:11px;color:var(--dim);margin-bottom:8px;">Cochez les opérateurs qui étaient présents avant de valider.</div>' : ''}
          <ul class="presence-roster">${rosterHTML}</ul>
        </div>
      </div>
    </article>`;
  }).join('');

  list.querySelectorAll('[data-presence]').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const opId = e.target.dataset.presence;
      const op = db.ops.find(opId);
      if (!op || op.validated) return;
      const presences = { ...op.presences };
      if (e.target.checked) presences[me.id] = true;
      else delete presences[me.id];
      db.ops.update(opId, { presences });
      logAction(`${e.target.checked ? 'Présence confirmée' : 'Présence retirée'} — ${op.name}`, 'PRES');
      renderAll();
    });
  });
  list.querySelectorAll('[data-roster]').forEach(cb => {
    cb.addEventListener('change', (e) => {
      if (!isLeader) return;
      const opId = e.target.dataset.roster;
      const uid = e.target.dataset.uid;
      const op = db.ops.find(opId);
      if (!op || op.validated) return;
      const presences = { ...op.presences };
      if (e.target.checked) presences[uid] = true;
      else delete presences[uid];
      db.ops.update(opId, { presences });
      const u = userById(uid);
      logAction(`${e.target.checked ? 'Ajouté' : 'Retiré'} au roster — ${u ? u.name : uid} (${op.name})`, 'ROST');
      renderAll();
    });
  });
  list.querySelectorAll('[data-validate]').forEach(b => {
    b.addEventListener('click', () => {
      const op = db.ops.find(b.dataset.validate);
      db.ops.update(op.id, { validated: true, validatedBy: me.id });
      logAction(`Effectifs validés — ${op.name}`, 'VAL');
      toast(`${op.name} : effectifs validés`);
      renderAll();
    });
  });
  list.querySelectorAll('[data-unvalidate]').forEach(b => {
    b.addEventListener('click', () => {
      const op = db.ops.find(b.dataset.unvalidate);
      db.ops.update(op.id, { validated: false, validatedBy: null });
      logAction(`Validation annulée — ${op.name}`, 'VAL');
      renderAll();
    });
  });
  list.querySelectorAll('[data-delete]').forEach(b => {
    b.addEventListener('click', async () => {
      const op = db.ops.find(b.dataset.delete);
      if (!await confirmDialog('Suppression', `Supprimer l'opération <strong>${op.name}</strong> ?`)) return;
      db.ops.delete(op.id);
      logAction(`Opération supprimée — ${op.name}`, 'OPS');
      toast('Opération supprimée');
      renderAll();
    });
  });
}

// =========================================================
//                        ABSENCES
// =========================================================
$('absForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const entry = {
    id: db.uid(),
    operator: $('absOperator').value,
    from: $('absFrom').value,
    to:   $('absTo').value,
    reason: $('absReason').value,
    comment: $('absComment').value.trim(),
    declaredBy: me.id,
    ts: Date.now(),
  };
  if (entry.operator !== me.id && !isLeader) { toast('Action refusée : permission insuffisante'); return; }
  if (new Date(entry.to) < new Date(entry.from)) { toast('Dates invalides'); return; }
  db.absences.insert(entry);
  logAction(`Absence déclarée — ${entry.operator} (${entry.reason})`, 'ABS');
  toast('Absence enregistrée');
  e.target.reset();
  $('absOperator').value = me.id;
  renderAll();
});

function renderAbsenceOperatorSelect() {
  const select = $('absOperator');
  const users = db.users.where(u => u.status === 'actif')
    .sort((a, b) => (gradeOf(a)?.tier || 99) - (gradeOf(b)?.tier || 99));
  const previous = select.value || me.id;
  select.innerHTML = users.map(u => {
    const g = gradeOf(u);
    return `<option value="${u.id}" ${u.id === previous ? 'selected' : ''}>${u.id} — ${g ? g.label : ''} ${u.name}</option>`;
  }).join('');
  if (!isLeader) { select.value = me.id; select.disabled = true; }
}

function renderAbsences() {
  const tbody = $('absTable');
  const abs = db.absences.all().sort((a, b) => new Date(a.from) - new Date(b.from));
  $('absCount').textContent = abs.length;
  if (abs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Aucune absence déclarée.</td></tr>';
    return;
  }
  tbody.innerHTML = abs.map(a => {
    const canDel = a.declaredBy === me.id || a.operator === me.id || isLeader;
    const u = userById(a.operator);
    const g = u ? gradeOf(u) : null;
    return `
    <tr>
      <td>
        <div style="display:flex;align-items:center;gap:10px;">
          <div class="mini-avatar">${u ? initials(u.name) : '?'}</div>
          <div>
            <div class="mono">${a.operator}</div>
            <div style="font-size:11px;color:var(--dim)">${g ? g.label : ''} ${u ? u.name : ''}</div>
          </div>
        </div>
      </td>
      <td>${fmtDate(a.from)} → ${fmtDate(a.to)}</td>
      <td>${a.reason}</td>
      <td>${a.comment || '—'}</td>
      <td class="row-actions">
        ${canDel ? `<button class="btn-danger btn-sm" data-del-abs="${a.id}">Retirer</button>` : ''}
      </td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('[data-del-abs]').forEach(b => {
    b.addEventListener('click', async () => {
      if (!await confirmDialog('Retrait', 'Retirer cette absence ?')) return;
      db.absences.delete(b.dataset.delAbs);
      logAction('Absence retirée', 'ABS');
      renderAll();
    });
  });
}

// =========================================================
//                  USER STATS (for promotions)
// =========================================================
function userStats(uid) {
  const ops = db.ops.all();
  const engaged   = ops.filter(o => o.presences[uid]).length;
  const validated = ops.filter(o => o.validated && o.presences[uid]).length;
  const absences  = db.absences.where(a => a.operator === uid).length;
  const trainings = db.trainings.where(t => Array.isArray(t.attendees) && t.attendees.includes(uid)).length;
  const specs = db.specializations.all().filter(s =>
    s.members.includes(uid) || s.leadId === uid || s.adjId === uid
  );
  return { engaged, validated, absences, trainings, specs };
}

function specRoleFor(spec, uid) {
  if (spec.leadId === uid) return 'Resp.';
  if (spec.adjId === uid)  return 'Adj.';
  if (spec.members.includes(uid)) return 'Membre';
  return null;
}

// =========================================================
//                       PERSONNEL
// =========================================================
function renderPersonnelStatsTable() {
  const tbody = $('personnelStatsTable');
  const users = db.users.all().sort((a, b) => (gradeOf(a)?.tier || 99) - (gradeOf(b)?.tier || 99));
  if (users.length === 0) { tbody.innerHTML = ''; return; }
  tbody.innerHTML = users.map(u => {
    const s = userStats(u.id);
    const g = gradeOf(u);
    const specs = s.specs.length === 0
      ? '<span style="color:var(--dim-2)">—</span>'
      : s.specs.map(sp => {
          const role = specRoleFor(sp, u.id);
          const cls = role === 'Resp.' ? 'spec-pill spec-lead' : role === 'Adj.' ? 'spec-pill spec-adj' : 'spec-pill';
          return `<span class="${cls}">${sp.name} <em>· ${role}</em></span>`;
        }).join(' ');
    return `<tr>
      <td>
        <div style="display:flex;align-items:center;gap:10px;">
          <div class="mini-avatar">${initials(u.name)}</div>
          <div>
            <div style="font-weight:600;">${u.name}</div>
            <div class="mono" style="font-size:10.5px;color:var(--dim);">${u.id}</div>
          </div>
        </div>
      </td>
      <td>${g ? g.label : '—'}</td>
      <td><div class="spec-cell">${specs}</div></td>
      <td><div class="spec-cell">${(() => {
        const cs = userCerts(u.id);
        return cs.length === 0
          ? '<span style="color:var(--dim-2)">—</span>'
          : cs.map(({ cert }) => `<span class="trainer-chip" style="font-family:var(--mono);font-weight:600;" title="${cert.name}">${cert.code}</span>`).join(' ');
      })()}</div></td>
      <td style="text-align:center;font-family:var(--mono);">${s.engaged}</td>
      <td style="text-align:center;font-family:var(--mono);color:${s.validated > 0 ? 'var(--ok)' : 'var(--dim)'};font-weight:600;">${s.validated}</td>
      <td style="text-align:center;font-family:var(--mono);">${s.trainings}</td>
      <td style="text-align:center;font-family:var(--mono);color:${s.absences > 0 ? 'var(--fg-2)' : 'var(--dim)'};">${s.absences}</td>
    </tr>`;
  }).join('');
}

function renderPersonnel() {
  const grid = $('personnelGrid');
  // Sort by hierarchy
  const users = db.users.all().sort((a, b) => (gradeOf(a)?.tier || 99) - (gradeOf(b)?.tier || 99));
  $('personnelCount').textContent = users.length;

  grid.innerHTML = users.map(u => {
    const g = gradeOf(u);
    const badgeCls = u.role === 'cmd' ? 'role-badge cmd' : u.role === 'lead' ? 'role-badge lead' : 'role-badge';
    const badgeTxt = g ? g.short : '—';
    const reserveCls = u.status === 'reserve' ? 'reserve' : '';
    const cmdCls = u.role === 'cmd' ? 'cmd' : '';
    return `
      <div class="person-card ${reserveCls} ${cmdCls}">
        <span class="${badgeCls}">${badgeTxt}</span>
        <div class="person-card-header">
          <div class="big-avatar">${initials(u.name)}</div>
          <div>
            <div class="person-id">${u.id}</div>
            <div class="person-name">${u.name}</div>
          </div>
        </div>
        <div class="person-rank">${g ? g.label : '—'}</div>
        <div class="person-appellation">${g ? '« ' + g.appel + ' »' : ''}</div>
      </div>`;
  }).join('');
}

// =========================================================
//                     SPECIALISATIONS
// =========================================================
const specForm = $('specForm');
const specFormPanel = $('specFormPanel');

function populateUserSelect(selectEl, currentId, allowEmpty = true) {
  const users = db.users.all().sort((a, b) => (gradeOf(a)?.tier || 99) - (gradeOf(b)?.tier || 99));
  const opts = [allowEmpty ? '<option value="">— Aucun —</option>' : '']
    .concat(users.map(u => {
      const g = gradeOf(u);
      return `<option value="${u.id}" ${u.id === currentId ? 'selected' : ''}>${u.id} — ${g ? g.label : ''} ${u.name}</option>`;
    }));
  selectEl.innerHTML = opts.join('');
}

function renderSpecsForm() {
  if (!isCmd) return;
  populateUserSelect($('specLead'), '', true);
  populateUserSelect($('specAdj'), '', true);
}

specForm?.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!isCmd) return;
  const spec = {
    id: db.uid(),
    name: $('specName').value.trim(),
    description: $('specDesc').value.trim(),
    leadId: $('specLead').value || null,
    adjId:  $('specAdj').value  || null,
    members: [],
    createdAt: Date.now(),
  };
  if (!spec.name) { toast('Nom requis'); return; }
  db.specializations.insert(spec);
  logAction(`Spécialisation créée — ${spec.name}`, 'SPEC');
  toast(`Spécialisation « ${spec.name} » créée`);
  specForm.reset();
  renderAll();
});

function canManageSpec(spec) {
  return isCmd || spec.leadId === me.id || spec.adjId === me.id;
}

function renderSpecs() {
  const list = $('specsList');
  const specs = db.specializations.all().sort((a, b) => a.name.localeCompare(b.name));
  $('specsCount').textContent = specs.length;

  if (specs.length === 0) {
    list.innerHTML = '<p class="empty-state">Aucune spécialisation enregistrée.</p>';
    return;
  }

  list.innerHTML = specs.map(spec => {
    const lead = spec.leadId ? userById(spec.leadId) : null;
    const adj  = spec.adjId  ? userById(spec.adjId)  : null;
    const leadG = lead ? gradeOf(lead) : null;
    const adjG  = adj  ? gradeOf(adj)  : null;

    const manage = canManageSpec(spec);
    const allUsers = db.users.where(u => u.status === 'actif')
      .sort((a, b) => (gradeOf(a)?.tier || 99) - (gradeOf(b)?.tier || 99));

    const membersHTML = manage
      ? allUsers.map(u => {
          const checked = spec.members.includes(u.id);
          const isLead = u.id === spec.leadId;
          const isAdj  = u.id === spec.adjId;
          const disabled = isLead || isAdj;
          const g = gradeOf(u);
          const tagRole = isLead ? '<span class="spec-pill spec-lead">Resp.</span>'
                       : isAdj  ? '<span class="spec-pill spec-adj">Adj.</span>'
                       : '';
          return `<li class="roster-editable ${checked || isLead || isAdj ? 'is-checked' : ''}">
            <label class="roster-toggle ${disabled ? 'disabled' : ''}">
              <input type="checkbox" data-spec-member="${spec.id}" data-uid="${u.id}" ${checked || isLead || isAdj ? 'checked' : ''} ${disabled ? 'disabled' : ''}/>
              <div class="roster-info">
                <div class="mini-avatar">${initials(u.name)}</div>
                <div>
                  <div class="op-id">${u.id} <span style="color:var(--dim);font-size:10px">· ${g ? g.short : '—'}</span></div>
                  <div class="op-name-small">${u.name}</div>
                </div>
              </div>
            </label>
            ${tagRole}
          </li>`;
        }).join('')
      : (spec.members.length === 0
          ? '<li class="empty-state">Aucun membre.</li>'
          : spec.members.map(uid => {
              const u = userById(uid); const g = u ? gradeOf(u) : null;
              return `<li>
                <div class="roster-info">
                  <div class="mini-avatar">${u ? initials(u.name) : '?'}</div>
                  <div>
                    <div class="op-id">${uid} <span style="color:var(--dim);font-size:10px">· ${g ? g.short : '—'}</span></div>
                    <div class="op-name-small">${u ? u.name : '—'}</div>
                  </div>
                </div>
              </li>`;
            }).join(''));

    const trainings = db.trainings.where(t => t.specId === spec.id)
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    const trainHTML = trainings.length === 0
      ? '<li class="empty-state">Aucune session enregistrée.</li>'
      : trainings.map(t => {
          const attendees = t.attendees || [];
          const canDel = manage;
          return `<li class="training-item">
            <div class="training-head">
              <div>
                <div class="training-title">${t.title}</div>
                <div class="training-meta">${fmtDateTime(t.date)} · ${attendees.length} participant(s)</div>
              </div>
              ${canDel ? `<button class="btn-danger btn-sm" data-del-training="${t.id}">Supprimer</button>` : ''}
            </div>
            ${t.description ? `<div class="training-desc">${t.description}</div>` : ''}
            <div class="training-attendees">
              ${manage ? allUsers.filter(u => spec.members.includes(u.id) || u.id === spec.leadId || u.id === spec.adjId)
                  .map(u => {
                    const isPresent = attendees.includes(u.id);
                    return `<label class="attendee-toggle ${isPresent ? 'is-checked' : ''}">
                      <input type="checkbox" data-train-attendee="${t.id}" data-uid="${u.id}" ${isPresent ? 'checked' : ''}/>
                      <span>${u.name}</span>
                    </label>`;
                  }).join('')
                : attendees.map(uid => {
                    const u = userById(uid);
                    return `<span class="attendee-pill">${u ? u.name : uid}</span>`;
                  }).join(' ')
              }
            </div>
          </li>`;
        }).join('');

    const memberCount = new Set([
      ...spec.members,
      ...(spec.leadId ? [spec.leadId] : []),
      ...(spec.adjId  ? [spec.adjId]  : []),
    ]).size;

    return `
    <article class="op-card spec-card" data-spec-id="${spec.id}">
      <header class="op-card-head">
        <div>
          <div class="op-title">${spec.name}</div>
          <div class="op-meta-line">
            <span class="meta"><strong>Resp.</strong> ${lead ? `${leadG ? leadG.short : ''} ${lead.name}` : '<span style="color:var(--dim)">non assigné</span>'}</span>
            <span class="meta"><strong>Adj.</strong> ${adj ? `${adjG ? adjG.short : ''} ${adj.name}` : '<span style="color:var(--dim)">non assigné</span>'}</span>
            <span class="badge">${memberCount} membres</span>
          </div>
        </div>
        <div class="op-actions">
          ${isCmd ? `<button class="btn-ghost btn-sm" data-edit-spec="${spec.id}">Éditer</button>` : ''}
          ${isCmd ? `<button class="btn-danger btn-sm" data-del-spec="${spec.id}">Supprimer</button>` : ''}
        </div>
      </header>
      ${spec.description ? `<div class="op-brief"><span>${spec.description}</span></div>` : ''}

      <div class="op-presence">
        <div class="presence-block">
          <h4>Membres <span class="count">${memberCount}</span></h4>
          ${manage ? '<div style="font-size:11px;color:var(--dim);margin-bottom:8px;">Cochez les opérateurs à inclure dans cette spécialisation.</div>' : ''}
          <ul class="presence-roster">${membersHTML}</ul>
        </div>

        <div class="presence-block">
          <h4>Sessions d'entraînement <span class="count">${trainings.length}</span></h4>
          ${manage ? `
            <form class="training-form" data-spec-id="${spec.id}">
              <input type="text" placeholder="Titre de la session" class="train-title" required/>
              <input type="datetime-local" class="train-date" required/>
              <textarea rows="2" placeholder="Objectifs, exercices..." class="train-desc"></textarea>
              <button type="submit" class="btn-primary btn-sm">Programmer la session</button>
            </form>
          ` : ''}
          <ul class="presence-roster training-list">${trainHTML}</ul>
        </div>
      </div>
    </article>`;
  }).join('');

  // --- Wire events ---

  // Member toggle
  list.querySelectorAll('[data-spec-member]').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const specId = e.target.dataset.specMember;
      const uid = e.target.dataset.uid;
      const spec = db.specializations.find(specId);
      if (!spec || !canManageSpec(spec)) return;
      const members = new Set(spec.members);
      if (e.target.checked) members.add(uid); else members.delete(uid);
      db.specializations.update(specId, { members: Array.from(members) });
      const u = userById(uid);
      logAction(`${e.target.checked ? 'Ajouté' : 'Retiré'} de « ${spec.name} » — ${u ? u.name : uid}`, 'SPEC');
      renderAll();
    });
  });

  // Edit spec (CMD)
  list.querySelectorAll('[data-edit-spec]').forEach(b => {
    b.addEventListener('click', () => openSpecEditModal(b.dataset.editSpec));
  });

  // Delete spec (CMD)
  list.querySelectorAll('[data-del-spec]').forEach(b => {
    b.addEventListener('click', async () => {
      const spec = db.specializations.find(b.dataset.delSpec);
      if (!await confirmDialog('Suppression', `Supprimer la spécialisation <strong>${spec.name}</strong> et toutes ses sessions ?`)) return;
      db.specializations.delete(spec.id);
      db.trainings.where(t => t.specId === spec.id).forEach(t => db.trainings.delete(t.id));
      logAction(`Spécialisation supprimée — ${spec.name}`, 'SPEC');
      toast('Spécialisation supprimée');
      renderAll();
    });
  });

  // Training form submit
  list.querySelectorAll('.training-form').forEach(form => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const specId = form.dataset.specId;
      const spec = db.specializations.find(specId);
      if (!spec || !canManageSpec(spec)) return;
      const t = {
        id: db.uid(),
        specId,
        title: form.querySelector('.train-title').value.trim(),
        date: new Date(form.querySelector('.train-date').value).toISOString(),
        description: form.querySelector('.train-desc').value.trim(),
        attendees: [],
        createdBy: me.id,
        createdAt: Date.now(),
      };
      if (!t.title) { toast('Titre requis'); return; }
      db.trainings.insert(t);
      logAction(`Session « ${t.title} » programmée — ${spec.name}`, 'TRAIN');
      toast('Session programmée');
      renderAll();
    });
  });

  // Training attendee toggle
  list.querySelectorAll('[data-train-attendee]').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const tid = e.target.dataset.trainAttendee;
      const uid = e.target.dataset.uid;
      const t = db.trainings.find(tid);
      if (!t) return;
      const spec = db.specializations.find(t.specId);
      if (!canManageSpec(spec)) return;
      const set = new Set(t.attendees || []);
      if (e.target.checked) set.add(uid); else set.delete(uid);
      db.trainings.update(tid, { attendees: Array.from(set) });
      renderAll();
    });
  });

  // Training delete
  list.querySelectorAll('[data-del-training]').forEach(b => {
    b.addEventListener('click', async () => {
      const t = db.trainings.find(b.dataset.delTraining);
      if (!t) return;
      const spec = db.specializations.find(t.specId);
      if (!canManageSpec(spec)) return;
      if (!await confirmDialog('Suppression', `Supprimer la session « ${t.title} » ?`)) return;
      db.trainings.delete(t.id);
      logAction(`Session supprimée — ${t.title}`, 'TRAIN');
      renderAll();
    });
  });
}

function openSpecEditModal(specId) {
  const spec = db.specializations.find(specId);
  if (!spec) return;
  const users = db.users.all().sort((a, b) => (gradeOf(a)?.tier || 99) - (gradeOf(b)?.tier || 99));
  const opt = (uid) => ['<option value="">— Aucun —</option>']
    .concat(users.map(u => {
      const g = gradeOf(u);
      return `<option value="${u.id}" ${u.id === uid ? 'selected' : ''}>${u.id} — ${g ? g.label : ''} ${u.name}</option>`;
    })).join('');

  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  back.innerHTML = `
    <div class="modal" style="max-width:520px;">
      <header>Modifier ${spec.name}</header>
      <div class="modal-body">
        <div class="form-grid" style="padding:0;grid-template-columns:1fr;gap:12px;">
          <label><span>Nom</span><input type="text" id="m-name" value="${spec.name.replace(/"/g,'&quot;')}"/></label>
          <label><span>Description</span><textarea id="m-desc" rows="2">${spec.description || ''}</textarea></label>
          <label><span>Responsable</span><select id="m-lead">${opt(spec.leadId)}</select></label>
          <label><span>Adjoint</span><select id="m-adj">${opt(spec.adjId)}</select></label>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn-ghost" data-act="no">Annuler</button>
        <button class="btn-primary" data-act="save">Enregistrer</button>
      </div>
    </div>`;
  document.body.appendChild(back);
  back.addEventListener('click', (e) => {
    const act = e.target.dataset.act;
    if (e.target === back || act === 'no') back.remove();
    if (act === 'save') {
      const patch = {
        name: back.querySelector('#m-name').value.trim() || spec.name,
        description: back.querySelector('#m-desc').value.trim(),
        leadId: back.querySelector('#m-lead').value || null,
        adjId:  back.querySelector('#m-adj').value  || null,
      };
      // Ensure leader/adj are not also members (cleaner)
      const members = spec.members.filter(uid => uid !== patch.leadId && uid !== patch.adjId);
      db.specializations.update(spec.id, { ...patch, members });
      logAction(`Spécialisation modifiée — ${patch.name}`, 'SPEC');
      toast('Spécialisation mise à jour');
      back.remove();
      renderAll();
    }
  });
}

// =========================================================
//                      ADMINISTRATION
// =========================================================
const userForm = $('userForm');
const userFormCancel = $('userFormCancel');

function populateGradeSelect() {
  const select = $('userGrade');
  const myTier = myGrade?.tier ?? 99;
  const groups = db.gradeGroups.map(group => {
    const opts = db.grades.filter(g => g.group === group && g.tier >= myTier)
      .map(g => `<option value="${g.key}">${g.label} — « ${g.appel} »</option>`).join('');
    return `<optgroup label="${group}">${opts}</optgroup>`;
  }).join('');
  select.innerHTML = groups;
  updateRoleDisplay();
}

function updateRoleDisplay() {
  const g = db.gradeByKey($('userGrade').value);
  const labels = { cmd: 'Officier supérieur (CMD)', lead: 'Officier / Sous-Officier (LEAD)', op: 'Militaire du Rang (OP)' };
  $('userRoleDisplay').value = g ? labels[g.role] : '';
}
// Auto-toggle canManageOps when grade changes (only if not editing an existing user)
$('userGrade')?.addEventListener('change', () => {
  updateRoleDisplay();
  const editing = !!$('userEditId').value;
  if (!editing) {
    const g = db.gradeByKey($('userGrade').value);
    $('userCanManageOps').checked = g ? g.tier <= 11 : false;
  }
});

function resetUserForm() {
  $('userEditId').value = '';
  $('userId').value = '';
  $('userId').disabled = false;
  $('userPwd').value = '';
  $('userPwd').placeholder = '********';
  $('userName2').value = '';
  $('userGrade').value = 'recrue';
  $('userStatus').value = 'actif';
  $('userCanManageOps').checked = false; // recrue default
  updateRoleDisplay();
  $('userFormTitle').textContent = 'Enregistrer un opérateur';
  userFormCancel.style.display = 'none';
}
userFormCancel?.addEventListener('click', resetUserForm);

userForm?.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!isCmd) { toast('Action refusée'); return; }

  const editId = $('userEditId').value;
  const gradeKey = $('userGrade').value;
  const grade = db.gradeByKey(gradeKey);
  if (!grade) { toast('Grade invalide'); return; }

  const data = {
    id: $('userId').value.trim(),
    password: $('userPwd').value,
    name: $('userName2').value.trim(),
    grade: gradeKey,
    role: grade.role,
    status: $('userStatus').value,
    canManageOps: $('userCanManageOps').checked,
  };
  if (!data.id || data.id.length < 2) { toast('Nom de code requis'); return; }
  if (!editId && !data.password) { toast('Code d\'accès requis à la création'); return; }

  // Hierarchy guard: cannot create/promote above own rank
  const myTier = myGrade?.tier ?? 99;
  if (grade.tier < myTier) { toast('Impossible : grade supérieur au tien'); return; }

  // Cannot edit an existing user that outranks me (server enforces too)
  if (editId && editId !== me.id) {
    const current = db.users.find(editId);
    const currentTier = current ? (db.gradeByKey(current.grade)?.tier ?? 99) : 99;
    if (currentTier < myTier) { toast('Impossible : opérateur de rang supérieur'); return; }
  }

  if (editId) {
    // Don't overwrite password if blank on edit
    const patch = { ...data };
    if (!patch.password) delete patch.password;
    delete patch.role; // role is server-derived
    db.users.update(editId, patch);
    logAction(`Opérateur modifié — ${data.id} (${grade.label})`, 'ADM');
    toast(`${data.id} mis à jour`);
  } else {
    if (db.users.find(data.id)) { toast('Matricule déjà existant'); return; }
    db.users.insert(data);
    logAction(`Opérateur enregistré — ${data.id} ${grade.label}`, 'ADM');
    toast(`${data.id} enregistré`);
  }
  resetUserForm();
  renderAll();
});

function renderUserAdmin() {
  const tbody = $('userTable');
  const myTier = myGrade?.tier ?? 99;
  const users = db.users.all().sort((a, b) => (gradeOf(a)?.tier || 99) - (gradeOf(b)?.tier || 99));
  tbody.innerHTML = users.map(u => {
    const g = gradeOf(u);
    const targetTier = g?.tier ?? 99;
    const outranks = targetTier < myTier && u.id !== me.id;
    return `
    <tr ${outranks ? 'class="row-locked"' : ''}>
      <td class="mono">${u.id}</td>
      <td>
        <div style="display:flex;align-items:center;gap:10px;">
          <div class="mini-avatar">${initials(u.name)}</div>
          <span>${u.name}</span>
        </div>
      </td>
      <td>${g ? g.label : '<span style="color:var(--dim)">—</span>'}</td>
      <td>${g ? g.group : '—'}</td>
      <td>${u.status === 'actif' ? 'Actif' : 'Réserve'}</td>
      <td>${u.canManageOps
        ? '<span class="perm-on">✓ Autorisé</span>'
        : '<span class="perm-off">— Désactivé</span>'}</td>
      <td class="row-actions">
        ${outranks
          ? '<span class="perm-off" title="Supérieur hiérarchique — verrouillé">🔒 Hors portée</span>'
          : `<button class="btn-ghost btn-sm" data-edit-user="${u.id}">Éditer</button>
             ${u.id !== me.id ? `<button class="btn-danger btn-sm" data-del-user="${u.id}">Supprimer</button>` : ''}`}
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('[data-edit-user]').forEach(b => {
    b.addEventListener('click', () => {
      const u = db.users.find(b.dataset.editUser);
      if (!u) return;
      $('userEditId').value = u.id;
      $('userId').value = u.id;
      $('userId').disabled = true;
      $('userPwd').value = ''; // password is never returned by the API
      $('userPwd').placeholder = 'Laisser vide pour conserver le code actuel';
      $('userName2').value = u.name;
      $('userGrade').value = u.grade || 'recrue';
      $('userStatus').value = u.status || 'actif';
      $('userCanManageOps').checked = !!u.canManageOps;
      updateRoleDisplay();
      $('userFormTitle').textContent = `Modifier ${u.id}`;
      userFormCancel.style.display = 'inline-flex';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
  tbody.querySelectorAll('[data-del-user]').forEach(b => {
    b.addEventListener('click', async () => {
      const u = db.users.find(b.dataset.delUser);
      if (!await confirmDialog('Suppression', `Supprimer l'opérateur <strong>${u.id}</strong> (${u.name}) ?`)) return;
      // Cascade cleanup is done atomically server-side (single transaction).
      // We still update the local cache for the related entities to keep UI in sync.
      db.ops.all().forEach(op => {
        if (op.presences && op.presences[u.id]) {
          const p = { ...op.presences }; delete p[u.id];
          op.presences = p;
        }
      });
      db.specializations.all().forEach(s => {
        if (s.leadId === u.id) s.leadId = null;
        if (s.adjId  === u.id) s.adjId  = null;
        if (s.members && s.members.includes(u.id)) s.members = s.members.filter(x => x !== u.id);
      });
      db.trainings.all().forEach(t => {
        if (Array.isArray(t.attendees) && t.attendees.includes(u.id)) {
          t.attendees = t.attendees.filter(x => x !== u.id);
        }
      });
      db.users.delete(u.id);
      logAction(`Opérateur supprimé — ${u.id}`, 'ADM');
      toast(`${u.id} supprimé`);
    });
  });
}

// =========================================================
//                        OVERVIEW
// =========================================================
function renderOverview() {
  const now = Date.now();
  const ops = db.ops.all();
  const users = db.users.all();

  const upcoming = ops.filter(o => new Date(o.date).getTime() >= now - 3600000);
  const totalPresences = ops.reduce((acc, o) => acc + Object.values(o.presences).filter(Boolean).length, 0);

  $('statPersonnel').textContent = users.filter(u => u.status === 'actif').length;
  $('statOps').textContent = upcoming.length;
  $('statPresences').textContent = totalPresences;

  const myOps = upcoming.filter(o => o.presences[me.id]).sort((a, b) => new Date(a.date) - new Date(b.date));
  $('myOpsMini').innerHTML = myOps.length === 0
    ? '<li class="empty-state">Aucune opération assignée.</li>'
    : myOps.map(o => `
        <li>
          <div>
            <div class="op-name">${o.name}</div>
            <div class="op-meta">${fmtDateTime(o.date)} · ${o.zone}</div>
          </div>
          <span class="badge ${o.priority.toLowerCase()}">${o.priority}</span>
        </li>`).join('');

  const log = db.log.all().slice(0, 15);
  $('activityList').innerHTML = log.length === 0
    ? '<li class="empty-state">Aucune activité enregistrée.</li>'
    : log.map(l => {
        const t = new Date(l.ts);
        return `<li>
          <span class="time">${pad(t.getHours())}:${pad(t.getMinutes())}</span>
          <span class="pill">${l.pill}</span>
          <span>${l.text} <em>· ${l.who}</em></span>
        </li>`;
      }).join('');
}

// =========================================================
//                  FORMATIONS & CERTIFICATIONS
// =========================================================
function isTrainerOf(cert) {
  if (!cert) return false;
  if (isCmd) return true;
  return Array.isArray(cert.trainers) && cert.trainers.includes(me.id);
}
function trainableCerts() {
  return db.certifications.all().filter(isTrainerOf);
}
function userCerts(userId) {
  return db.certHolders.forUser(userId)
    .map(h => ({ holder: h, cert: db.certifications.find(h.certId) }))
    .filter(x => x.cert)
    .sort((a, b) => a.cert.code.localeCompare(b.cert.code));
}

// ---- My certifications ----
function renderMyCerts() {
  const list = $('myCertsList');
  const mine = userCerts(me.id);
  $('myCertsCount').textContent = mine.length;
  if (mine.length === 0) {
    list.innerHTML = '<div class="empty-state">Aucune certification obtenue à ce jour.</div>';
    return;
  }
  list.innerHTML = mine.map(({ holder, cert }) => {
    const date = new Date(holder.awardedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
    const awarder = holder.awardedBy ? userById(holder.awardedBy) : null;
    return `<div class="cert-card">
      <div class="cert-code">${cert.code}</div>
      <div class="cert-info">
        <div class="cert-name">${cert.name}</div>
        <div class="cert-meta">Obtenue le ${date}${awarder ? ` · validée par ${awarder.name}` : ''}</div>
      </div>
    </div>`;
  }).join('');
}

// ---- Catalog ----
function renderCertsCatalog() {
  const list = $('certsList');
  const certs = db.certifications.all().sort((a, b) => a.code.localeCompare(b.code));
  $('newCertBtn').style.display = isCmd ? 'inline-flex' : 'none';
  if (certs.length === 0) {
    list.innerHTML = '<div class="empty-state">Aucune certification définie. Le commandement peut en créer dans le catalogue.</div>';
    return;
  }
  list.innerHTML = certs.map(c => {
    const trainers = (c.trainers || []).map(uid => {
      const u = userById(uid);
      return u ? `<span class="trainer-chip">${u.name}</span>` : '';
    }).join('');
    const holders = db.certHolders.forCert(c.id);
    const canTrain = isTrainerOf(c);
    return `<div class="cert-row">
      <div class="cert-row-head">
        <div class="cert-code">${c.code}</div>
        <div class="cert-row-title">
          <div class="cert-name">${c.name}</div>
          ${c.description ? `<div class="cert-desc">${c.description}</div>` : ''}
        </div>
        <div class="cert-row-actions">
          ${canTrain ? '<span class="perm-on">✓ Vous formez</span>' : ''}
          ${isCmd ? `
            <button class="btn-ghost btn-sm" data-edit-cert="${c.id}">Éditer</button>
            <button class="btn-danger btn-sm" data-del-cert="${c.id}">Supprimer</button>` : ''}
        </div>
      </div>
      <div class="cert-row-body">
        <div class="cert-section">
          <span class="cert-section-label">Formateurs (${(c.trainers || []).length})</span>
          <div class="cert-chips">${trainers || '<span style="color:var(--dim)">— aucun —</span>'}</div>
        </div>
        <div class="cert-section">
          <span class="cert-section-label">Détenteurs (${holders.length})</span>
          <div class="cert-chips">${holders.length === 0 ? '<span style="color:var(--dim)">— aucun —</span>' :
            holders.map(h => {
              const u = userById(h.userId);
              return `<span class="holder-chip">
                ${u ? u.name : h.userId}
                ${isCmd ? `<button class="chip-x" data-revoke-cert="${c.id}" data-revoke-user="${h.userId}" title="Révoquer">×</button>` : ''}
              </span>`;
            }).join('')}</div>
        </div>
      </div>
    </div>`;
  }).join('');

  // Wire up actions
  list.querySelectorAll('[data-edit-cert]').forEach(b => {
    b.addEventListener('click', () => editCert(b.dataset.editCert));
  });
  list.querySelectorAll('[data-del-cert]').forEach(b => {
    b.addEventListener('click', async () => {
      const c = db.certifications.find(b.dataset.delCert);
      if (!c) return;
      if (!await confirmDialog('Suppression',
        `Supprimer la certification ${c.code} ?\n\nToutes les formations associées et les attestations délivrées seront effacées.`)) return;
      await db.certifications.delete(c.id);
      logAction(`Certification supprimée — ${c.code}`, 'CERT');
      toast(`${c.code} supprimée`);
    });
  });
  list.querySelectorAll('[data-revoke-cert]').forEach(b => {
    b.addEventListener('click', async () => {
      const certId = b.dataset.revokeCert;
      const userId = b.dataset.revokeUser;
      const c = db.certifications.find(certId);
      const u = userById(userId);
      if (!await confirmDialog('Révocation', `Retirer la certification ${c?.code} à ${u?.name || userId} ?`)) return;
      await db.certHolders.revoke(certId, userId);
      logAction(`Certification ${c?.code} révoquée — ${u?.name || userId}`, 'CERT');
      toast('Certification révoquée');
    });
  });
}

// ---- Cert form (CMD) ----
function populateTrainerSelect(selectEl, currentTrainerIds = []) {
  const users = db.users.all().sort((a, b) => (gradeOf(a)?.tier || 99) - (gradeOf(b)?.tier || 99));
  const set = new Set(currentTrainerIds);
  selectEl.innerHTML = users.map(u => {
    const g = gradeOf(u);
    return `<option value="${u.id}" ${set.has(u.id) ? 'selected' : ''}>${u.id} — ${g ? g.short : ''} · ${u.name}</option>`;
  }).join('');
}
function resetCertForm() {
  $('certEditId').value = '';
  $('certCode').value = '';
  $('certName').value = '';
  $('certDesc').value = '';
  populateTrainerSelect($('certTrainers'), []);
  $('certFormTitle').textContent = 'Nouvelle certification';
  $('certFormPanel').style.display = 'none';
}
function editCert(id) {
  const c = db.certifications.find(id);
  if (!c) return;
  $('certEditId').value = c.id;
  $('certCode').value = c.code;
  $('certName').value = c.name;
  $('certDesc').value = c.description || '';
  populateTrainerSelect($('certTrainers'), c.trainers || []);
  $('certFormTitle').textContent = `Édition — ${c.code}`;
  $('certFormPanel').style.display = '';
  $('certFormPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

if ($('newCertBtn')) {
  $('newCertBtn').addEventListener('click', () => {
    resetCertForm();
    $('certFormPanel').style.display = '';
    $('certFormPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}
if ($('certCancelBtn')) {
  $('certCancelBtn').addEventListener('click', resetCertForm);
}
if ($('certForm')) {
  $('certForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!isCmd) return;
    const editId = $('certEditId').value;
    const code = $('certCode').value.trim().toUpperCase();
    const name = $('certName').value.trim();
    const description = $('certDesc').value.trim();
    const trainers = Array.from($('certTrainers').selectedOptions).map(o => o.value);
    if (!code || !name) { toast('Code et nom requis'); return; }

    if (editId) {
      await db.certifications.update(editId, { code, name, description, trainers });
      logAction(`Certification mise à jour — ${code}`, 'CERT');
      toast(`${code} mise à jour`);
    } else {
      await db.certifications.insert({ id: db.uid(), code, name, description, trainers });
      logAction(`Certification créée — ${code}`, 'CERT');
      toast(`${code} créée`);
    }
    resetCertForm();
  });
}

// ---- Formation form (trainers) ----
function populateFormationCertSelect() {
  const sel = $('formationCert');
  const certs = trainableCerts().sort((a, b) => a.code.localeCompare(b.code));
  if (certs.length === 0) {
    sel.innerHTML = '<option value="">— aucune certif accessible —</option>';
    return;
  }
  const cur = sel.value;
  sel.innerHTML = certs.map(c =>
    `<option value="${c.id}" ${c.id === cur ? 'selected' : ''}>${c.code} — ${c.name}</option>`
  ).join('');
}
function resetFormationForm() {
  $('formationEditId').value = '';
  $('formationTitle').value = '';
  $('formationDate').value = '';
  $('formationLocation').value = '';
  $('formationDesc').value = '';
  $('formationFormTitle').textContent = 'Programmer une formation';
  $('formationCancelBtn').style.display = 'none';
  populateFormationCertSelect();
}
function editFormation(id) {
  const f = db.formations.find(id);
  if (!f) return;
  $('formationEditId').value = f.id;
  populateFormationCertSelect();
  $('formationCert').value = f.certId;
  $('formationTitle').value = f.title;
  // datetime-local needs YYYY-MM-DDTHH:mm in local time
  const d = new Date(f.date);
  const isoLocal = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  $('formationDate').value = isoLocal;
  $('formationLocation').value = f.location || '';
  $('formationDesc').value = f.description || '';
  $('formationFormTitle').textContent = `Édition — ${f.title}`;
  $('formationCancelBtn').style.display = '';
  $('formationFormPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
if ($('formationCancelBtn')) {
  $('formationCancelBtn').addEventListener('click', resetFormationForm);
}
if ($('formationForm')) {
  $('formationForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const editId = $('formationEditId').value;
    const certId = $('formationCert').value;
    const cert = db.certifications.find(certId);
    if (!cert) { toast('Certification invalide'); return; }
    if (!isTrainerOf(cert)) { toast('Tu n\'es pas formateur sur cette certification'); return; }
    const title = $('formationTitle').value.trim();
    const date = new Date($('formationDate').value).toISOString();
    const location = $('formationLocation').value.trim();
    const description = $('formationDesc').value.trim();
    if (!title) { toast('Intitulé requis'); return; }

    if (editId) {
      await db.formations.update(editId, { title, date, location, description });
      logAction(`Formation modifiée — ${title}`, 'FORM');
      toast('Formation mise à jour');
    } else {
      await db.formations.insert({
        id: db.uid(), certId, title, date, location, description,
        attendees: {}, validated: false,
      });
      logAction(`Formation programmée — ${title} (${cert.code})`, 'FORM');
      toast(`Formation « ${title} » programmée`);
    }
    resetFormationForm();
  });
}

// ---- Formations list ----
function renderFormations() {
  // Visibility: form panel only if user can train at least one cert
  const canTrainSomething = trainableCerts().length > 0;
  $('formationFormPanel').style.display = canTrainSomething ? '' : 'none';
  populateFormationCertSelect();

  const list = $('formationsList');
  const formations = db.formations.all()
    .sort((a, b) => new Date(b.date) - new Date(a.date)); // most recent first
  $('formationsCount').textContent = formations.length;

  if (formations.length === 0) {
    list.innerHTML = '<div class="empty-state">Aucune formation programmée.</div>';
    return;
  }

  list.innerHTML = formations.map(f => {
    const cert = db.certifications.find(f.certId);
    const canTrain = isTrainerOf(cert);
    const isPast = new Date(f.date) < new Date();
    const att = f.attendees || {};
    const presentIds = Object.keys(att).filter(k => att[k]);
    const meChecked = !!att[me.id];

    // Roster: editable for trainers, otherwise only the present list
    let rosterHTML = '';
    if (canTrain) {
      const activeUsers = db.users.where(u => u.status === 'actif')
        .sort((a, b) => (gradeOf(a)?.tier || 99) - (gradeOf(b)?.tier || 99));
      rosterHTML = activeUsers.length === 0
        ? '<li class="empty-state">Aucun opérateur actif.</li>'
        : activeUsers.map(u => {
            const g = gradeOf(u);
            const checked = !!att[u.id];
            const hasIt = cert ? db.certHolders.has(u.id, cert.id) : false;
            return `<li class="roster-editable ${checked ? 'is-checked' : ''}">
              <label class="roster-toggle">
                <input type="checkbox" data-form-roster="${f.id}" data-uid="${u.id}" ${checked ? 'checked' : ''} ${f.validated ? 'disabled' : ''}/>
                <div class="roster-info">
                  <div class="mini-avatar">${initials(u.name)}</div>
                  <div>
                    <div class="op-id">${u.id} <span style="color:var(--dim);font-size:10px">· ${g ? g.short : '—'}</span>
                      ${hasIt ? '<span class="perm-on" style="font-size:10px;margin-left:6px;">✓ déjà certifié</span>' : ''}
                    </div>
                    <div class="op-name-small">${u.name}</div>
                  </div>
                </div>
              </label>
            </li>`;
          }).join('');
    } else {
      rosterHTML = presentIds.length === 0
        ? '<li class="empty-state">Aucun inscrit pour le moment.</li>'
        : presentIds
            .map(id => ({ id, u: userById(id) }))
            .sort((a, b) => {
              const ga = a.u && gradeOf(a.u); const gb = b.u && gradeOf(b.u);
              return (ga ? ga.tier : 99) - (gb ? gb.tier : 99);
            })
            .map(({ id, u }) => {
              const g = u ? gradeOf(u) : null;
              const cls = f.validated ? 'confirm-ok' : 'confirm-pending';
              const txt = f.validated ? 'Certifié' : 'Inscrit';
              return `<li>
                <div class="roster-info">
                  <div class="mini-avatar">${u ? initials(u.name) : '?'}</div>
                  <div>
                    <div class="op-id">${id} <span style="color:var(--dim);font-size:10px">· ${g ? g.short : '—'}</span></div>
                    <div class="op-name-small">${u ? u.name : '— inconnu —'}</div>
                  </div>
                </div>
                <span class="${cls}">${txt}</span>
              </li>`;
            }).join('');
    }

    // Self-toggle (everyone, except if validated or trainer manages roster)
    const selfToggle = !f.validated && !canTrain ? `
      <label class="self-toggle">
        <input type="checkbox" data-form-self="${f.id}" ${meChecked ? 'checked' : ''}/>
        <span>${meChecked ? '✓ Inscrit·e' : 'M\'inscrire'}</span>
      </label>` : '';

    const validationBtns = canTrain && !f.validated ? `
      <button class="btn-primary btn-sm" data-form-validate="${f.id}">
        Valider la formation (délivrer ${cert?.code || '?'})
      </button>` : f.validated && canTrain ? `
      <button class="btn-ghost btn-sm" data-form-unvalidate="${f.id}">Annuler la validation</button>` : '';

    const editBtn = canTrain && !f.validated ? `
      <button class="btn-ghost btn-sm" data-form-edit="${f.id}">Éditer</button>` : '';
    const delBtn = (canTrain || f.createdBy === me.id) ? `
      <button class="btn-danger btn-sm" data-form-delete="${f.id}">Supprimer</button>` : '';

    return `<article class="op-card ${f.validated ? 'is-validated' : ''} ${isPast && !f.validated ? 'is-past' : ''}">
      <header class="op-card-head">
        <div class="op-meta">
          <span class="op-cert-pill">${cert ? cert.code : '?'}</span>
          <span class="op-date">${fmtDateTime(f.date)}</span>
          ${f.location ? `<span class="op-loc">${f.location}</span>` : ''}
          ${f.validated ? '<span class="op-badge ok">✓ Validée</span>' : ''}
          ${isPast && !f.validated ? '<span class="op-badge warn">⏱ À valider</span>' : ''}
        </div>
        <h4>${f.title}</h4>
        ${cert ? `<div class="op-subtitle">${cert.name}</div>` : ''}
        ${f.description ? `<p class="op-brief">${f.description}</p>` : ''}
      </header>
      <div class="op-roster">
        <div class="op-roster-head">
          <strong>${canTrain ? 'Inscrire les opérateurs présents' : 'Participants'}</strong>
          <span class="muted">${presentIds.length} inscrit${presentIds.length > 1 ? 's' : ''}</span>
        </div>
        <ul>${rosterHTML}</ul>
      </div>
      <footer class="op-actions">
        ${selfToggle}
        ${validationBtns}
        ${editBtn}
        ${delBtn}
      </footer>
    </article>`;
  }).join('');

  // ---- Wire actions ----
  list.querySelectorAll('[data-form-self]').forEach(cb => {
    cb.addEventListener('change', async (e) => {
      const fid = e.target.dataset.formSelf;
      const f = db.formations.find(fid);
      if (!f) return;
      const att = { ...(f.attendees || {}) };
      if (e.target.checked) att[me.id] = true; else delete att[me.id];
      await db.formations.update(fid, { attendees: att });
      logAction(`${e.target.checked ? 'Inscription' : 'Désinscription'} formation — ${f.title}`, 'FORM');
    });
  });
  list.querySelectorAll('[data-form-roster]').forEach(cb => {
    cb.addEventListener('change', async (e) => {
      const fid = e.target.dataset.formRoster;
      const uid = e.target.dataset.uid;
      const f = db.formations.find(fid);
      if (!f) return;
      const att = { ...(f.attendees || {}) };
      if (e.target.checked) att[uid] = true; else delete att[uid];
      await db.formations.update(fid, { attendees: att });
      const u = userById(uid);
      logAction(`${e.target.checked ? 'Ajouté' : 'Retiré'} de la formation ${f.title} — ${u ? u.name : uid}`, 'FORM');
    });
  });
  list.querySelectorAll('[data-form-validate]').forEach(b => {
    b.addEventListener('click', async () => {
      const f = db.formations.find(b.dataset.formValidate);
      const cert = db.certifications.find(f.certId);
      const present = Object.entries(f.attendees || {}).filter(([_, v]) => v).length;
      if (!await confirmDialog('Validation',
        `Valider cette formation ?\n\n${present} opérateur(s) recevront la certification ${cert?.code || '?'}.\n\nCette action est réversible.`)) return;
      await db.formations.update(f.id, { validated: true });
      // Optimistically add holders to local cache (server has already done it)
      Object.entries(f.attendees || {}).filter(([_, v]) => v).forEach(([uid]) => {
        db.certHolders.addLocal({
          certId: cert.id, userId: uid,
          awardedAt: Date.now(), awardedBy: me.id, formationId: f.id,
        });
      });
      logAction(`Formation validée — ${f.title} (+${present} ${cert?.code || '?'})`, 'CERT');
      toast(`${present} opérateur(s) certifié(s) ${cert?.code || ''}`);
    });
  });
  list.querySelectorAll('[data-form-unvalidate]').forEach(b => {
    b.addEventListener('click', async () => {
      const f = db.formations.find(b.dataset.formUnvalidate);
      if (!await confirmDialog('Annulation', 'Annuler la validation et révoquer les certifications délivrées par cette formation ?')) return;
      await db.formations.update(f.id, { validated: false });
      db.certHolders.removeByFormation(f.id);
      logAction(`Validation annulée — ${f.title}`, 'CERT');
      toast('Certifications révoquées');
    });
  });
  list.querySelectorAll('[data-form-edit]').forEach(b => {
    b.addEventListener('click', () => editFormation(b.dataset.formEdit));
  });
  list.querySelectorAll('[data-form-delete]').forEach(b => {
    b.addEventListener('click', async () => {
      const f = db.formations.find(b.dataset.formDelete);
      if (!await confirmDialog('Suppression', `Supprimer la formation « ${f.title} » ?`)) return;
      await db.formations.delete(f.id);
      logAction(`Formation supprimée — ${f.title}`, 'FORM');
      toast('Formation supprimée');
    });
  });
}

// =========================================================
//                       MASTER RENDER
// =========================================================
function renderAll() {
  if (!me) return;
  renderOps();
  renderAbsenceOperatorSelect();
  renderAbsences();
  renderPersonnel();
  renderPersonnelStatsTable();
  renderSpecsForm();
  renderSpecs();
  renderMyCerts();
  renderCertsCatalog();
  renderFormations();
  if (isCmd) renderUserAdmin();
  renderOverview();
}

// Expose toast globally for db.js error reporting.
window.STRIX = window.STRIX || {};
window.STRIX.toast = toast;

// =========================================================
//                       BOOTSTRAP
// =========================================================
(async function bootstrap() {
  // Show a quick loading state
  $('viewTitle').textContent = 'Connexion à la base…';

  const ok = await db.init();
  if (!ok) {
    db.auth.logout();
    window.location.href = 'index.html';
    return;
  }

  me = db.auth.me();
  if (!me) { db.auth.logout(); window.location.href = 'index.html'; return; }
  myGrade = db.gradeByKey(me.grade) || { label: '—', appel: '', role: 'op' };
  isLeader = !!me.canManageOps || me.role === 'cmd';
  isCmd    = me.role === 'cmd';

  $('viewTitle').textContent = 'Tableau de bord';
  setupUserPanel();
  if (isCmd) populateGradeSelect();

  // Re-render automatically when cache mutates
  db.setRenderCallback(renderAll);

  renderAll();

  // First-login mandatory password change
  if (me.mustChangePassword) {
    forcePasswordChange();
  }
})();

// =========================================================
//                  FIRST-LOGIN PASSWORD CHANGE
// =========================================================
function forcePasswordChange() {
  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  back.innerHTML = `
    <div class="modal modal-pwd">
      <header>Changement de code obligatoire</header>
      <div class="modal-body">
        <p style="margin:0 0 12px 0; color:var(--dim); font-size:12.5px; line-height:1.5;">
          Première connexion détectée. Définis un nouveau code d'accès personnel avant d'accéder au terminal.
        </p>
        <label style="display:flex; flex-direction:column; gap:6px; margin-bottom:10px;">
          <span style="font-size:11px; color:var(--dim); letter-spacing:0.1em; text-transform:uppercase;">Nouveau code</span>
          <input type="password" id="newPwd1" autocomplete="new-password" required minlength="4" style="padding:10px 12px;"/>
        </label>
        <label style="display:flex; flex-direction:column; gap:6px;">
          <span style="font-size:11px; color:var(--dim); letter-spacing:0.1em; text-transform:uppercase;">Confirmation</span>
          <input type="password" id="newPwd2" autocomplete="new-password" required minlength="4" style="padding:10px 12px;"/>
        </label>
        <div id="pwdError" style="margin-top:10px; color:var(--danger); font-size:12px; min-height:14px;"></div>
      </div>
      <div class="modal-actions">
        <button class="btn-primary" id="pwdSubmit">Confirmer</button>
      </div>
    </div>`;
  document.body.appendChild(back);

  // Block interaction with the rest of the UI
  back.style.zIndex = '9999';

  const submit = back.querySelector('#pwdSubmit');
  const p1 = back.querySelector('#newPwd1');
  const p2 = back.querySelector('#newPwd2');
  const err = back.querySelector('#pwdError');
  p1.focus();

  async function apply() {
    err.textContent = '';
    const v1 = p1.value;
    const v2 = p2.value;
    if (v1.length < 4) { err.textContent = 'Au moins 4 caractères'; return; }
    if (v1 !== v2)     { err.textContent = 'Les deux codes ne correspondent pas'; return; }
    if (v1 === 'strix2025') { err.textContent = 'Choisis un code différent du code par défaut'; return; }
    submit.disabled = true;
    submit.textContent = 'Mise à jour…';
    try {
      await db.auth.changePassword(v1);
      logAction('Code d\'accès personnel mis à jour', 'AUTH');
      toast('Code d\'accès enregistré');
      back.remove();
    } catch (e) {
      err.textContent = e.message || 'Erreur';
      submit.disabled = false;
      submit.textContent = 'Confirmer';
    }
  }
  submit.addEventListener('click', apply);
  [p1, p2].forEach(el => el.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); apply(); }
  }));
  // Prevent dismissal by clicking the backdrop
  back.addEventListener('click', (e) => { if (e.target === back) e.stopPropagation(); });
}
