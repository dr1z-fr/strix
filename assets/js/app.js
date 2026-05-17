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
})();
