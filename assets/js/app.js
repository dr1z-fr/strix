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
let canManageCerts = false;
let canViewDossier = false;
let canViewMedical = false;
let currentView = 'home';

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

  const doLogout = async () => {
    if (!await confirmDialog('Déconnexion', 'Confirmer la fin de session ?')) return;
    logAction(`Déconnexion — ${me.name}`, 'AUTH');
    setTimeout(() => { db.auth.logout(); window.location.href = 'index.html'; }, 100);
  };
  $('logoutBtn').addEventListener('click', doLogout);

  if (!isCmd) {
    const t = $('tileAdmin'); if (t) t.style.display = 'none';
  }
  if (!canViewDossier) {
    const tl = $('tileLogs'); if (tl) tl.style.display = 'none';
  }
  if (!canViewMedical) {
    const tm = $('tileMedical'); if (tm) tm.style.display = 'none';
  }
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

// ---- Navigation (mode tablette : home + apps full-screen) ----
const VIEWS = {
  home:       { title: '',                 crumb: 'HOME' },
  ops:        { title: 'Opérations',       crumb: 'Opérations' },
  absences:   { title: 'Absences',         crumb: 'Absences' },
  personnel:  { title: 'Personnel',        crumb: 'Personnel' },
  specs:      { title: 'Spécialisations',  crumb: 'Spécialisations' },
  formations: { title: 'Formations',       crumb: 'Formations' },
  docs:       { title: 'Documentation',    crumb: 'Documentation' },
  logs:       { title: 'Journal d\'activité', crumb: 'Logs' },
  medical:    { title: 'Médical',          crumb: 'Médical' },
  admin:      { title: 'Administration',   crumb: 'Admin' },
  dossier:    { title: 'Dossier',          crumb: 'Dossier' },
};
function goToView(v, params) {
  if (!VIEWS[v]) v = 'home';
  currentView = v;
  document.querySelectorAll('.view').forEach(s => s.classList.toggle('active', s.id === `view-${v}`));
  $('viewTitle').textContent = VIEWS[v].title;
  const crumb = $('viewCrumb'); if (crumb) crumb.textContent = VIEWS[v].crumb;
  // Back button : depuis le dossier on revient à Personnel, sinon à l'accueil
  const back = $('backToHome');
  if (back) {
    if (v === 'home') {
      back.style.display = 'none';
    } else {
      back.style.display = 'inline-flex';
      const target = (v === 'dossier') ? 'personnel' : 'home';
      const label  = (v === 'dossier') ? 'Personnel' : 'Accueil';
      back.dataset.target = target;
      const span = back.querySelector('span'); if (span) span.textContent = label;
    }
  }
  // Lock scroll uniquement sur la home (les autres vues scrollent normalement)
  document.body.classList.toggle('lock-scroll', v === 'home');
  document.body.dataset.view = v;
  if (v === 'dossier' && params?.userId) renderDossier(params.userId);
  window.scrollTo(0, 0);
}
document.querySelectorAll('.app-tile').forEach(btn => {
  btn.addEventListener('click', () => goToView(btn.dataset.view));
});
$('backToHome')?.addEventListener('click', (e) => {
  goToView(e.currentTarget.dataset.target || 'home');
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
  const allOps = db.ops.all().sort((a, b) => new Date(a.date) - new Date(b.date));
  $('opsCount').textContent = allOps.length;

  if (allOps.length === 0) {
    list.innerHTML = '<p class="empty-state">Aucune opération programmée.</p>';
    return;
  }

  // Séparer : ops actives (non validées = à venir/en cours) vs archivées (validées = terminées)
  const activeOps = allOps.filter(o => !o.validated);
  const archivedOps = allOps.filter(o => o.validated)
    .sort((a, b) => new Date(b.date) - new Date(a.date)); // archives : plus récent en premier

  const totalActive = db.users.where(u => u.status === 'actif').length;

  const renderCard = (op) => {
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
      ${(() => {
        const hasNote = !!(op.notes && op.notes.trim());
        if (!isLeader && !hasNote) return '';
        return `<div class="op-notes ${hasNote ? 'has-note' : ''}">
          <div class="op-notes-head">
            <strong>Note du gérant d'op</strong>
            ${isLeader ? `<button class="btn-ghost btn-sm" data-edit-note="${op.id}">${hasNote ? 'Modifier' : '+ Ajouter une note'}</button>` : ''}
          </div>
          ${hasNote ? `<div class="op-notes-body" data-note-body="${op.id}">${(op.notes || '').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</div>` : ''}
          <div class="op-notes-edit" id="op-notes-edit-${op.id}" style="display:none;">
            <textarea data-note-textarea="${op.id}" rows="4" placeholder="Debrief, retours terrain, points d'attention...">${(op.notes || '').replace(/</g, '&lt;')}</textarea>
            <div class="op-notes-actions">
              <button class="btn-primary btn-sm" data-save-note="${op.id}">Enregistrer</button>
              <button class="btn-ghost btn-sm" data-cancel-note="${op.id}">Annuler</button>
              ${hasNote ? `<button class="btn-danger btn-sm" data-clear-note="${op.id}" style="margin-left:auto;">Effacer</button>` : ''}
            </div>
          </div>
        </div>`;
      })()}
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
  };

  // Active ops first, then archived (validated) collapsed in <details>
  const activeHTML = activeOps.length
    ? activeOps.map(renderCard).join('')
    : '<p class="empty-state">Aucune opération active.</p>';

  let archivedHTML = '';
  if (archivedOps.length) {
    archivedHTML = `
      <details class="ops-archive">
        <summary>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"/></svg>
          <span>Opérations archivées</span>
          <span class="archive-count">${archivedOps.length}</span>
          <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><path d="M6 9l6 6 6-6"/></svg>
        </summary>
        <div class="ops-archive-list">
          ${archivedOps.map(op => {
            const confirmed = Object.keys(op.presences || {}).filter(k => op.presences[k]).length;
            return `<div class="ops-archive-row" data-archive-toggle="${op.id}">
              <div class="ops-archive-row-head">
                <span class="ops-archive-name">${escapeHTML(op.name)}</span>
                <span class="ops-archive-meta">${fmtDateTime(op.date)} · ${escapeHTML(op.zone)} · ${confirmed} effectif(s)</span>
                <span class="ops-archive-status">VALIDÉE</span>
                <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="12" height="12"><path d="M6 9l6 6 6-6"/></svg>
              </div>
              <div class="ops-archive-row-body" id="archive-body-${op.id}" hidden></div>
            </div>`;
          }).join('')}
        </div>
      </details>`;
  }

  list.innerHTML = activeHTML + archivedHTML;

  // Expand archived row on click → render full card lazily inside its body
  list.querySelectorAll('[data-archive-toggle]').forEach(row => {
    row.querySelector('.ops-archive-row-head').addEventListener('click', () => {
      const id = row.dataset.archiveToggle;
      const body = $(`archive-body-${id}`);
      const op = db.ops.find(id);
      if (!body || !op) return;
      if (body.hidden) {
        body.innerHTML = renderCard(op);
        body.hidden = false;
        row.classList.add('open');
      } else {
        body.hidden = true;
        body.innerHTML = '';
        row.classList.remove('open');
      }
    });
  });

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

  // ===== Notes du gérant d'op =====
  list.querySelectorAll('[data-edit-note]').forEach(b => {
    b.addEventListener('click', () => {
      if (!isLeader) return;
      const opId = b.dataset.editNote;
      const editor = $(`op-notes-edit-${opId}`);
      const body = list.querySelector(`[data-note-body="${opId}"]`);
      if (editor) editor.style.display = '';
      if (body) body.style.display = 'none';
    });
  });
  list.querySelectorAll('[data-cancel-note]').forEach(b => {
    b.addEventListener('click', () => {
      const opId = b.dataset.cancelNote;
      const editor = $(`op-notes-edit-${opId}`);
      const body = list.querySelector(`[data-note-body="${opId}"]`);
      if (editor) editor.style.display = 'none';
      if (body) body.style.display = '';
    });
  });
  list.querySelectorAll('[data-save-note]').forEach(b => {
    b.addEventListener('click', async () => {
      if (!isLeader) return;
      const opId = b.dataset.saveNote;
      const op = db.ops.find(opId);
      if (!op) return;
      const ta = list.querySelector(`[data-note-textarea="${opId}"]`);
      const value = (ta?.value || '').trim();
      await db.ops.update(opId, { notes: value });
      logAction(`Note d'op ${value ? 'mise à jour' : 'effacée'} — ${op.name}`, 'OPS');
      toast(value ? 'Note enregistrée' : 'Note effacée');
      renderAll();
    });
  });
  list.querySelectorAll('[data-clear-note]').forEach(b => {
    b.addEventListener('click', async () => {
      if (!isLeader) return;
      const opId = b.dataset.clearNote;
      const op = db.ops.find(opId);
      if (!op) return;
      if (!await confirmDialog('Effacer la note', `Supprimer la note de l'opération <strong>${op.name}</strong> ?`)) return;
      await db.ops.update(opId, { notes: '' });
      logAction(`Note d'op effacée — ${op.name}`, 'OPS');
      toast('Note effacée');
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
      <td><div class="spec-cell">${(() => {
        const tc = db.certifications.all().filter(c => c.trainers && c.trainers.includes(u.id));
        return tc.length === 0
          ? '<span style="color:var(--dim-2)">—</span>'
          : tc.map(c => `<span class="trainer-chip is-trainer" style="font-family:var(--mono);font-weight:600;color:var(--ok);" title="${c.name}">${c.code}</span>`).join(' ');
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
        ${canViewDossier ? `<button class="btn-ghost btn-sm dossier-btn" data-open-dossier="${u.id}">Ouvrir dossier</button>` : ''}
      </div>`;
  }).join('');

  grid.querySelectorAll('[data-open-dossier]').forEach(b => {
    b.addEventListener('click', () => goToView('dossier', { userId: b.dataset.openDossier }));
  });
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
              ${(() => {
                const specUsers = allUsers.filter(u => spec.members.includes(u.id) || u.id === spec.leadId || u.id === spec.adjId);
                if (manage) {
                  return specUsers.map(u => {
                    const isPresent = attendees.includes(u.id);
                    return `<label class="attendee-toggle ${isPresent ? 'is-checked' : ''}">
                      <input type="checkbox" data-train-attendee="${t.id}" data-uid="${u.id}" ${isPresent ? 'checked' : ''}/>
                      <span>${u.name}</span>
                    </label>`;
                  }).join('');
                }
                const isMember = specUsers.some(u => u.id === me.id);
                if (!isMember) {
                  return attendees.map(uid => {
                    const u = userById(uid);
                    return `<span class="attendee-pill">${u ? u.name : uid}</span>`;
                  }).join(' ');
                }
                return specUsers.map(u => {
                  const isPresent = attendees.includes(u.id);
                  if (u.id === me.id) {
                    return `<label class="attendee-toggle ${isPresent ? 'is-checked' : ''}">
                      <input type="checkbox" data-train-attendee="${t.id}" data-uid="${u.id}" ${isPresent ? 'checked' : ''}/>
                      <span>${u.name}</span>
                    </label>`;
                  }
                  return isPresent ? `<span class="attendee-pill">${u.name}</span>` : '';
                }).join('');
              })()}
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
      const isSelf = uid === me.id;
      const isMember = spec && (spec.members.includes(me.id) || spec.leadId === me.id || spec.adjId === me.id);
      if (!canManageSpec(spec) && !(isSelf && isMember)) return;
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

  const codeName = $('userId').value.trim();
  const data = {
    id: codeName,
    password: $('userPwd').value,
    name: codeName,                       // nom complet = nom de code (champ supprimé)
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

// =========================================================
//                       DOCUMENTATION
// =========================================================
let docsFilterCategory = ''; // '' = toutes

function escapeHTML(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Rendu très léger : titres (# ##), gras (**x**), italique (*x*), listes (- x)
function renderDocContent(raw) {
  const safe = escapeHTML(raw);
  const lines = safe.split(/\n/);
  let html = '';
  let inList = false;
  for (let line of lines) {
    if (/^\s*-\s+/.test(line)) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${line.replace(/^\s*-\s+/, '')}</li>`;
      continue;
    }
    if (inList) { html += '</ul>'; inList = false; }
    if (/^##\s+/.test(line))       html += `<h4>${line.replace(/^##\s+/, '')}</h4>`;
    else if (/^#\s+/.test(line))   html += `<h3>${line.replace(/^#\s+/, '')}</h3>`;
    else if (line.trim() === '')   html += '<br>';
    else                            html += `<p>${line}</p>`;
  }
  if (inList) html += '</ul>';
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return html;
}

function renderDocs() {
  const list = $('docsList');
  const filter = $('docsFilter');
  const countTag = $('docsCount');
  const newBtn = $('newDocBtn');
  if (!list) return;

  const docs = db.documents.all().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (countTag) countTag.textContent = docs.length;
  if (newBtn) newBtn.style.display = isCmd ? 'inline-flex' : 'none';

  // Datalist (catégories existantes)
  const dl = $('docCategoryList');
  if (dl) {
    const cats = [...new Set(docs.map(d => d.category).filter(Boolean))].sort();
    dl.innerHTML = cats.map(c => `<option value="${escapeHTML(c)}"></option>`).join('');
  }

  // Filtre catégorie
  const categories = [...new Set(docs.map(d => d.category).filter(Boolean))].sort();
  if (filter) {
    filter.innerHTML = `
      <button class="doc-chip ${docsFilterCategory === '' ? 'is-active' : ''}" data-cat="">Toutes <span class="doc-chip-count">${docs.length}</span></button>
      ${categories.map(c => {
        const n = docs.filter(d => d.category === c).length;
        return `<button class="doc-chip ${docsFilterCategory === c ? 'is-active' : ''}" data-cat="${escapeHTML(c)}">${escapeHTML(c)} <span class="doc-chip-count">${n}</span></button>`;
      }).join('')}
    `;
    filter.querySelectorAll('[data-cat]').forEach(b => {
      b.addEventListener('click', () => {
        docsFilterCategory = b.dataset.cat;
        renderDocs();
      });
    });
  }

  const filtered = docsFilterCategory
    ? docs.filter(d => d.category === docsFilterCategory)
    : docs;

  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state" style="padding:32px;text-align:center;">
      <div style="font-size:13px;color:var(--dim);">Aucune fiche disponible${docsFilterCategory ? ` dans « ${escapeHTML(docsFilterCategory)} »` : ''}.</div>
      ${isCmd ? '<div style="font-size:11.5px;color:var(--dim-2);margin-top:4px;">Cliquez sur <strong>+ Nouvelle fiche</strong> pour en créer une.</div>' : ''}
    </div>`;
    return;
  }

  list.innerHTML = filtered.map(d => {
    const author = userById(d.createdBy);
    const updated = new Date(d.updatedAt || d.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
    return `<article class="doc-card" data-doc="${d.id}">
      <header class="doc-card-head">
        <div>
          <h4 class="doc-card-title">${escapeHTML(d.title)}</h4>
          <div class="doc-card-meta">
            ${d.category ? `<span class="doc-cat-pill">${escapeHTML(d.category)}</span>` : ''}
            <span>Mise à jour ${updated}</span>
            ${author ? `<span>· ${escapeHTML(author.name)}</span>` : ''}
          </div>
        </div>
        <div class="doc-card-actions">
          <button class="btn-ghost btn-sm" data-toggle-doc="${d.id}">Lire</button>
          ${isCmd ? `<button class="btn-ghost btn-sm" data-edit-doc="${d.id}">Éditer</button>` : ''}
          ${isCmd ? `<button class="btn-danger btn-sm" data-del-doc="${d.id}">Suppr.</button>` : ''}
        </div>
      </header>
      <div class="doc-card-body" id="doc-body-${d.id}" style="display:none;">
        ${renderDocContent(d.content)}
      </div>
    </article>`;
  }).join('');

  list.querySelectorAll('[data-toggle-doc]').forEach(b => {
    b.addEventListener('click', () => {
      const id = b.dataset.toggleDoc;
      const body = $(`doc-body-${id}`);
      if (!body) return;
      const open = body.style.display !== 'none';
      body.style.display = open ? 'none' : '';
      b.textContent = open ? 'Lire' : 'Réduire';
    });
  });
  list.querySelectorAll('[data-edit-doc]').forEach(b => {
    b.addEventListener('click', () => editDoc(b.dataset.editDoc));
  });
  list.querySelectorAll('[data-del-doc]').forEach(b => {
    b.addEventListener('click', async () => {
      const d = db.documents.find(b.dataset.delDoc);
      if (!d) return;
      if (!await confirmDialog('Suppression', `Supprimer la fiche <strong>${escapeHTML(d.title)}</strong> ?`)) return;
      await db.documents.delete(d.id);
      logAction(`Doc supprimée — ${d.title}`, 'DOC');
      toast('Fiche supprimée');
    });
  });
}

function resetDocForm() {
  $('docEditId').value = '';
  $('docTitle').value = '';
  $('docCategory').value = '';
  $('docContent').value = '';
  $('docFormTitle').textContent = 'Nouvelle fiche';
  $('docFormPanel').style.display = 'none';
}
function editDoc(id) {
  const d = db.documents.find(id);
  if (!d) return;
  $('docEditId').value = d.id;
  $('docTitle').value = d.title;
  $('docCategory').value = d.category || '';
  $('docContent').value = d.content;
  $('docFormTitle').textContent = `Édition — ${d.title}`;
  $('docFormPanel').style.display = '';
  $('docFormPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
if ($('newDocBtn')) {
  $('newDocBtn').addEventListener('click', () => {
    resetDocForm();
    $('docFormPanel').style.display = '';
    $('docFormPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}
if ($('docCancelBtn')) {
  $('docCancelBtn').addEventListener('click', resetDocForm);
}
if ($('docForm')) {
  $('docForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!isCmd) return;
    const editId = $('docEditId').value;
    const title = $('docTitle').value.trim();
    const category = $('docCategory').value.trim();
    const content = $('docContent').value.trim();
    if (!title || !content) { toast('Titre et contenu requis'); return; }

    if (editId) {
      await db.documents.update(editId, { title, category, content });
      logAction(`Doc mise à jour — ${title}`, 'DOC');
      toast(`${title} mise à jour`);
    } else {
      await db.documents.insert({ id: db.uid(), title, category, content, createdBy: me.id, createdAt: Date.now(), updatedAt: Date.now() });
      logAction(`Doc créée — ${title}`, 'DOC');
      toast(`${title} créée`);
    }
    resetDocForm();
  });
}

// =========================================================
//                       DOSSIER (Lt et +)
// =========================================================
let currentDossierUserId = null;

const SANCTION_TYPES = [
  { key: 'avertissement', label: 'Avertissement', tone: 'warn' },
  { key: 'blame',         label: 'Blâme',         tone: 'warn' },
  { key: 'degradation',   label: 'Dégradation',   tone: 'bad' },
  { key: 'exclusion',     label: 'Exclusion',     tone: 'bad' },
];

function renderDossier(userId) {
  currentDossierUserId = userId;
  const root = $('dossierContent');
  if (!root) return;

  if (!canViewDossier) {
    root.innerHTML = '<div class="panel"><div class="panel-body"><p class="empty-state">Accès réservé aux officiers (Lieutenant et +).</p></div></div>';
    return;
  }

  const u = db.users.find(userId);
  if (!u) {
    root.innerHTML = '<div class="panel"><div class="panel-body"><p class="empty-state">Opérateur introuvable.</p></div></div>';
    return;
  }
  const g = gradeOf(u);
  const targetTier = g?.tier ?? 99;
  const myTier = myGrade?.tier ?? 99;
  const outranks = targetTier < myTier && u.id !== me.id;

  // Stats agrégées
  const allOps = db.ops.all();
  const engaged = allOps.filter(o => o.presences && o.presences[u.id]).length;
  const validated = allOps.filter(o => o.validated && o.presences && o.presences[u.id]).length;
  const trainings = db.trainings.all().filter(t => (t.attendees || []).includes(u.id)).length;
  const absencesAll = db.absences.where(a => a.operator === u.id).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const absencesCount = absencesAll.length;

  // Spécialisations — calcule la principale automatiquement
  const specs = db.specializations.all().filter(s =>
    (s.members || []).includes(u.id) || s.leadId === u.id || s.adjId === u.id
  );
  // Priorité : LEAD > ADJ > 1er membre
  const primarySpec = (() => {
    const asLead = specs.find(s => s.leadId === u.id);
    if (asLead) return { name: asLead.name, role: 'LEAD' };
    const asAdj  = specs.find(s => s.adjId === u.id);
    if (asAdj) return { name: asAdj.name, role: 'ADJ' };
    if (specs.length) return { name: specs[0].name, role: 'MEMBRE' };
    return null;
  })();

  // Certifs et formateur
  const userCertList = userCerts(u.id);
  const trainerOf = db.certifications.all().filter(c => (c.trainers || []).includes(u.id));

  // Sanctions
  const sanctionsList = db.sanctions.where(s => s.userId === u.id)
    .sort((a, b) => (b.issuedAt || 0) - (a.issuedAt || 0));

  const statusBadge = u.status === 'reserve'
    ? '<span class="status-badge status-reserve">RÉSERVE</span>'
    : '<span class="status-badge status-active">ACTIF</span>';
  const roleBadge = u.role === 'cmd' ? '<span class="role-badge cmd">CMD</span>'
                  : u.role === 'lead' ? '<span class="role-badge lead">OFF</span>'
                  : '<span class="role-badge">RG</span>';

  const canEdit = !outranks;

  root.innerHTML = `
    <!-- Header dossier avec bouton retour + identité -->
    <div class="dossier-head panel">
      <button class="dossier-back" id="dossierBack" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        Retour à Personnel
      </button>
      <div class="dossier-head-main">
        <div class="dossier-avatar">${initials(u.name)}</div>
        <div class="dossier-ident">
          <div class="dossier-name">${escapeHTML(u.name)}</div>
          <div class="dossier-grade">${g ? escapeHTML(g.label) : '—'} ${roleBadge} ${statusBadge}</div>
          <div class="dossier-id">Matricule <strong>${escapeHTML(u.id)}</strong>${g ? ` · « ${escapeHTML(g.appel)} »` : ''}</div>
        </div>
      </div>
      ${outranks ? '<div class="dossier-locked">⚠ Opérateur de rang supérieur — consultation seule, modifications interdites.</div>' : ''}
    </div>

    <!-- Statistiques carrière -->
    <div class="panel dossier-section">
      <header class="panel-header"><h3>Statistiques de carrière</h3><span class="tag">CARRIÈRE</span></header>
      <div class="dossier-stats">
        <div class="dstat"><span class="dstat-val">${engaged}</span><span class="dstat-lbl">Ops engagées</span></div>
        <div class="dstat"><span class="dstat-val" style="color:var(--ok)">${validated}</span><span class="dstat-lbl">Ops validées</span></div>
        <div class="dstat"><span class="dstat-val">${trainings}</span><span class="dstat-lbl">Entraînements</span></div>
        <div class="dstat"><span class="dstat-val" style="color:${absencesCount > 0 ? 'var(--fg-2)' : 'var(--dim)'}">${absencesCount}</span><span class="dstat-lbl">Absences</span></div>
      </div>
    </div>

    <!-- Affectations & qualifications -->
    ${(specs.length || userCertList.length || trainerOf.length) ? `
    <div class="panel dossier-section">
      <header class="panel-header"><h3>Affectations &amp; qualifications</h3></header>
      <div class="dossier-affect">
        ${specs.length ? `<div class="affect-row"><span class="dossier-sub">Spécialisations</span><div class="dossier-chips">${specs.map(s => `<span class="trainer-chip">${escapeHTML(s.name)}${s.leadId === u.id ? ' · LEAD' : s.adjId === u.id ? ' · ADJ' : ''}</span>`).join('')}</div></div>` : ''}
        ${userCertList.length ? `<div class="affect-row"><span class="dossier-sub">Certifications</span><div class="dossier-chips">${userCertList.map(({cert}) => `<span class="trainer-chip" style="font-family:var(--mono);font-weight:600;">${escapeHTML(cert.code)}</span>`).join('')}</div></div>` : ''}
        ${trainerOf.length ? `<div class="affect-row"><span class="dossier-sub">Formateur de</span><div class="dossier-chips">${trainerOf.map(c => `<span class="trainer-chip" style="font-family:var(--mono);font-weight:600;color:var(--ok);">${escapeHTML(c.code)}</span>`).join('')}</div></div>` : ''}
      </div>
    </div>` : ''}

    <!-- Identité RP -->
    <div class="panel dossier-section">
      <header class="panel-header"><h3>Identité RP &amp; biographie</h3><span class="tag">DOSSIER</span></header>
      <form class="form-grid dossier-form" id="dossierForm">
        <label><span>Date d'incorporation</span>
          <input type="date" id="dossierJoinedAt" value="${u.joinedAt || ''}" ${canEdit ? '' : 'disabled'}/>
        </label>
        <label><span>Spécialité principale <em style="font-style:normal;color:var(--dim-2);font-size:10px;letter-spacing:0.08em;text-transform:uppercase;margin-left:6px;">· auto</em></span>
          <div class="dossier-primary-spec">
            ${primarySpec
              ? `<span class="trainer-chip" style="font-size:12px;padding:6px 12px;">${escapeHTML(primarySpec.name)}<span style="color:var(--dim);margin-left:8px;font-size:10px;letter-spacing:0.1em;">${primarySpec.role}</span></span>`
              : `<span class="empty-state" style="padding:6px 0;display:inline-block;">Non affecté à une spécialisation.</span>`}
          </div>
        </label>
        <label class="full"><span>Biographie / notes</span>
          <textarea id="dossierBio" rows="5" placeholder="Parcours, antécédents, mentions..." ${canEdit ? '' : 'disabled'}>${escapeHTML(u.bio || '')}</textarea>
        </label>
        ${canEdit ? `<div class="full actions">
          <button type="submit" class="btn-primary">Enregistrer le dossier</button>
        </div>` : ''}
      </form>
    </div>

    <!-- Sanctions -->
    <div class="panel">
      <header class="panel-header">
        <h3>Sanctions disciplinaires</h3>
        <span class="tag" style="background:${sanctionsList.length ? 'rgba(232,107,107,0.15)' : ''};color:${sanctionsList.length ? 'var(--fg-2)' : 'var(--dim)'};">${sanctionsList.length}</span>
      </header>
      <div class="panel-body">
        ${canEdit ? `<form id="sanctionForm" class="sanction-form">
          <select id="sanctionType" required>
            ${SANCTION_TYPES.map(t => `<option value="${t.key}">${t.label}</option>`).join('')}
          </select>
          <input type="text" id="sanctionReason" placeholder="Motif détaillé..." required/>
          <button type="submit" class="btn-danger">Appliquer la sanction</button>
        </form>` : ''}
        <ul class="sanction-list">
          ${sanctionsList.length === 0
            ? '<li class="empty-state">Aucune sanction au dossier.</li>'
            : sanctionsList.map(s => {
                const issuer = userById(s.issuedBy);
                const typeMeta = SANCTION_TYPES.find(t => t.key === s.type) || { label: s.type, tone: 'warn' };
                const d = new Date(s.issuedAt);
                return `<li class="sanction-item tone-${typeMeta.tone}">
                  <div class="sanction-main">
                    <div class="sanction-head">
                      <span class="sanction-type">${escapeHTML(typeMeta.label)}</span>
                      <span class="sanction-date">${d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })} ${pad(d.getHours())}:${pad(d.getMinutes())}</span>
                    </div>
                    <div class="sanction-reason">${escapeHTML(s.reason)}</div>
                    <div class="sanction-meta">Émise par ${issuer ? `<strong>${escapeHTML(issuer.name)}</strong>` : `<em>${s.issuedBy || '?'}</em>`}</div>
                  </div>
                  ${canEdit ? `<button class="btn-ghost btn-sm" data-del-sanction="${s.id}" title="Retirer">×</button>` : ''}
                </li>`;
              }).join('')
          }
        </ul>
      </div>
    </div>

    <!-- Absences historique -->
    <div class="panel">
      <header class="panel-header">
        <h3>Historique des absences</h3>
        <span class="tag">${absencesCount}</span>
      </header>
      <div class="panel-body">
        ${absencesAll.length === 0
          ? '<p class="empty-state">Aucune absence enregistrée.</p>'
          : `<table class="data-table">
              <thead><tr><th>Période</th><th>Motif</th><th>Commentaire</th><th>Déclarée par</th></tr></thead>
              <tbody>${absencesAll.map(a => {
                const dec = userById(a.declaredBy);
                return `<tr>
                  <td><strong>${a.from}</strong> → <strong>${a.to}</strong></td>
                  <td>${escapeHTML(a.reason)}</td>
                  <td>${escapeHTML(a.comment || '—')}</td>
                  <td>${dec ? escapeHTML(dec.name) : `<em>${a.declaredBy || '?'}</em>`}</td>
                </tr>`;
              }).join('')}</tbody>
            </table>`
        }
      </div>
    </div>
  `;

  // Handlers
  $('dossierBack')?.addEventListener('click', () => goToView('personnel'));
  const form = $('dossierForm');
  if (form && canEdit) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const patch = {
        bio: $('dossierBio').value.trim(),
        joinedAt: $('dossierJoinedAt').value || null,
      };
      try {
        await db.dossier.update(u.id, patch);
        logAction(`Dossier RP mis à jour — ${u.id}`, 'DOS');
        toast('Dossier enregistré');
      } catch {}
    });
  }
  const sForm = $('sanctionForm');
  if (sForm && canEdit) {
    sForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const type = $('sanctionType').value;
      const reason = $('sanctionReason').value.trim();
      if (!reason) { toast('Motif requis'); return; }
      const record = { id: db.uid(), userId: u.id, type, reason, issuedBy: me.id, issuedAt: Date.now() };
      try {
        await db.sanctions.insert(record);
        const typeMeta = SANCTION_TYPES.find(t => t.key === type);
        logAction(`Sanction appliquée — ${u.id} : ${typeMeta?.label || type}`, 'SAN');
        toast(`${typeMeta?.label || 'Sanction'} appliquée`);
        $('sanctionReason').value = '';
      } catch {}
    });
  }
  root.querySelectorAll('[data-del-sanction]').forEach(b => {
    b.addEventListener('click', async () => {
      const sId = b.dataset.delSanction;
      const s = db.sanctions.find(sId);
      if (!s) return;
      if (!await confirmDialog('Retirer la sanction', 'Confirmer le retrait de cette sanction ?')) return;
      try {
        await db.sanctions.delete(sId);
        logAction(`Sanction retirée — ${u.id}`, 'SAN');
        toast('Sanction retirée');
      } catch {}
    });
  });
}

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
      <td>
        <div style="display:flex;align-items:center;gap:10px;">
          <div class="mini-avatar">${initials(u.id)}</div>
          <span class="mono">${u.id}</span>
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
//                        HOME (springboard)
// =========================================================
function renderHome() {
  const now = Date.now();
  const ops = db.ops.all();
  const users = db.users.all();

  const upcoming = ops.filter(o => new Date(o.date).getTime() >= now - 3600000);
  const totalPresences = ops.reduce((acc, o) => acc + Object.values(o.presences).filter(Boolean).length, 0);

  $('statPersonnel').textContent = users.filter(u => u.status === 'actif').length;
  $('statOps').textContent = upcoming.length;
  $('statPresences').textContent = totalPresences;

  // Greeting
  const hour = new Date().getHours();
  const greet = hour < 6 ? 'Bonne nuit' : hour < 12 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir';
  if ($('homeGreeting')) {
    $('homeGreeting').textContent = `${greet}, ${myGrade?.label || ''} ${me?.name || ''}.`;
  }

  // App tile badges
  const setBadge = (id, n) => { const e = $(id); if (e) e.textContent = n; if (e) e.style.display = n > 0 ? '' : 'none'; };
  setBadge('badgeOps', upcoming.length);
  setBadge('badgePersonnel', users.length);
  setBadge('badgeAbsences', db.absences.all().filter(a => new Date(a.to) >= new Date(Date.now() - 86400000)).length);
  setBadge('badgeSpecs', db.specializations.all().length);
  setBadge('badgeFormations', db.formations.all().filter(f => !f.validated).length);
  setBadge('badgeDocs', db.documents.all().length);

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
  if (canManageCerts) return true;
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

// ---- My certifications (medals) ----
function renderMyCerts() {
  const list = $('myCertsList');
  const mine = userCerts(me.id);
  $('myCertsCount').textContent = mine.length;
  if (mine.length === 0) {
    list.innerHTML = `<div class="empty-state" style="padding:24px;text-align:center;">
      <div style="font-size:13px;color:var(--dim);">Aucune certification obtenue.</div>
      <div style="font-size:11.5px;color:var(--dim-2);margin-top:4px;">Tes futures certifications apparaîtront ici après validation par un formateur.</div>
    </div>`;
    return;
  }
  list.innerHTML = mine.map(({ holder, cert }) => {
    const date = new Date(holder.awardedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
    const awarder = holder.awardedBy ? userById(holder.awardedBy) : null;
    return `<div class="medal" title="${cert.name}">
      <div class="medal-disc">${cert.code}</div>
      <div class="medal-info">
        <div class="medal-name">${cert.name}</div>
        <div class="medal-meta">${date}${awarder ? ` · ${awarder.name}` : ''}</div>
      </div>
    </div>`;
  }).join('');
}

// ---- Catalog ----
function renderCertsCatalog() {
  const list = $('certsList');
  const certs = db.certifications.all().sort((a, b) => a.code.localeCompare(b.code));
  $('newCertBtn').style.display = canManageCerts ? 'inline-flex' : 'none';
  if (certs.length === 0) {
    list.innerHTML = `<div class="empty-state" style="padding:32px;text-align:center;grid-column:1/-1;">
      <div style="font-size:13px;color:var(--dim);">Aucune certification définie.</div>
      ${canManageCerts ? '<div style="font-size:11.5px;color:var(--dim-2);margin-top:4px;">Cliquez sur <strong>+ Nouvelle</strong> pour commencer.</div>' : ''}
    </div>`;
    return;
  }
  list.innerHTML = certs.map(c => {
    const trainers = (c.trainers || []);
    const holders = db.certHolders.forCert(c.id);
    const canTrain = isTrainerOf(c);
    const trainersHTML = trainers.length === 0
      ? '<span class="chip-empty">— aucun formateur désigné —</span>'
      : trainers.map(uid => {
          const u = userById(uid);
          return u ? `<span class="trainer-chip" title="${u.id}">${u.name}</span>` : '';
        }).join('');
    const holdersHTML = holders.length === 0
      ? '<span class="chip-empty">— aucun détenteur —</span>'
      : holders.map(h => {
          const u = userById(h.userId);
          return `<span class="holder-chip">
            ${u ? u.name : h.userId}
            ${canManageCerts ? `<button class="chip-x" data-revoke-cert="${c.id}" data-revoke-user="${h.userId}" title="Révoquer">×</button>` : ''}
          </span>`;
        }).join('');
    return `<div class="cert-tile ${canTrain ? 'is-trainer' : ''}">
      <div class="cert-tile-head">
        <div class="cert-disc">${c.code}</div>
        <div class="cert-tile-title">
          <div class="cert-tile-name">${c.name}</div>
          ${c.description ? `<div class="cert-tile-desc">${c.description}</div>` : ''}
          ${canTrain ? '<div class="cert-tile-trainer-flag">✓ Vous formez</div>' : ''}
        </div>
      </div>
      <div class="cert-tile-body">
        <div>
          <div class="cert-section-label">Formateurs <span class="cert-section-count">${trainers.length}</span></div>
          <div class="cert-chips">${trainersHTML}</div>
        </div>
        <div>
          <div class="cert-section-label">Détenteurs <span class="cert-section-count">${holders.length}</span></div>
          <div class="cert-chips">${holdersHTML}</div>
        </div>
      </div>
      ${canManageCerts ? `<div class="cert-tile-actions">
        <button class="btn-ghost btn-sm" data-edit-cert="${c.id}" style="flex:1;">Éditer</button>
        <button class="btn-danger btn-sm" data-del-cert="${c.id}" style="flex:1;">Supprimer</button>
      </div>` : ''}
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
    if (!canManageCerts) return;
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
  $('formationFormPanel').style.display = 'none';
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
  $('formationFormPanel').style.display = '';
  $('formationFormPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
if ($('newFormationBtn')) {
  $('newFormationBtn').addEventListener('click', () => {
    resetFormationForm();
    $('formationFormPanel').style.display = '';
    $('formationFormPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}
if ($('formationCancelBtn')) {
  $('formationCancelBtn').addEventListener('click', () => {
    resetFormationForm();
    $('formationFormPanel').style.display = 'none';
  });
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

// ---- Formations list (groupées par état) ----
function renderFormationCard(f) {
  const cert = db.certifications.find(f.certId);
  const canTrain = isTrainerOf(cert);
  const now = new Date();
  const fDate = new Date(f.date);
  const isPast = fDate < now;
  const att = f.attendees || {};
  const presentIds = Object.keys(att).filter(k => att[k]);
  const meChecked = !!att[me.id];

  let stateClass = '', statusBadge = '';
  if (f.validated) {
    stateClass = 'is-validated';
    statusBadge = '<span class="formation-status-badge done">✓ Validée</span>';
  } else if (isPast) {
    stateClass = 'is-todo';
    statusBadge = '<span class="formation-status-badge todo">⏱ À valider</span>';
  } else {
    statusBadge = '<span class="formation-status-badge upcoming">À venir</span>';
  }
  if (f.validated) stateClass += ' is-locked';

  // Roster
  let rosterHTML = '';
  if (canTrain && !f.validated) {
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
              <input type="checkbox" data-form-roster="${f.id}" data-uid="${u.id}" ${checked ? 'checked' : ''}/>
              <div class="roster-info">
                <div class="mini-avatar">${initials(u.name)}</div>
                <div>
                  <div class="op-id">${u.id} <span style="color:var(--dim);font-size:10px">· ${g ? g.short : '—'}</span>
                    ${hasIt ? '<span class="already-cert">✓ déjà certifié</span>' : ''}
                  </div>
                  <div class="op-name-small">${u.name}</div>
                </div>
              </div>
            </label>
          </li>`;
        }).join('');
  } else {
    rosterHTML = presentIds.length === 0
      ? '<li class="empty-state" style="grid-column:1/-1;">Aucun inscrit pour le moment.</li>'
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

  // Actions footer
  const selfToggle = !f.validated && !canTrain ? `
    <label class="self-toggle ${meChecked ? 'is-on' : ''}">
      <input type="checkbox" data-form-self="${f.id}" ${meChecked ? 'checked' : ''}/>
      <span>${meChecked ? '✓ Inscrit·e' : '+ M\'inscrire'}</span>
    </label>` : '';

  let trainerActions = '';
  if (canTrain && !f.validated) {
    trainerActions = `
      <button class="btn-primary btn-sm" data-form-validate="${f.id}">
        🎖 Valider — délivrer ${cert?.code || '?'}
      </button>
      <button class="btn-ghost btn-sm" data-form-edit="${f.id}">Éditer</button>
      <button class="btn-danger btn-sm" data-form-delete="${f.id}">Supprimer</button>`;
  } else if (canTrain && f.validated) {
    trainerActions = `
      <button class="btn-ghost btn-sm" data-form-unvalidate="${f.id}">Annuler la validation</button>`;
  } else if (f.createdBy === me.id && !f.validated) {
    trainerActions = `<button class="btn-danger btn-sm" data-form-delete="${f.id}">Supprimer</button>`;
  }

  const dateIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`;
  const locIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>`;

  return `<article class="formation-card ${stateClass}">
    <header class="formation-head">
      <div class="formation-cert-disc" title="${cert ? cert.name : ''}">${cert ? cert.code : '?'}</div>
      <div class="formation-headline">
        <h4>${f.title}</h4>
        ${cert ? `<div class="formation-cert-name">${cert.name}</div>` : ''}
        <div class="formation-meta">
          <span>${dateIcon}${fmtDateTime(f.date)}</span>
          ${f.location ? `<span>${locIcon}${f.location}</span>` : ''}
        </div>
      </div>
      <div class="formation-status">
        ${statusBadge}
        <span class="formation-attendees-count">${presentIds.length} inscrit${presentIds.length > 1 ? 's' : ''}</span>
      </div>
    </header>
    ${f.description ? `<div class="formation-brief">${f.description}</div>` : ''}
    <div class="formation-roster">
      <div class="formation-roster-head">
        <strong>${canTrain && !f.validated ? 'Cocher les présents' : (f.validated ? 'Opérateurs certifiés' : 'Inscrits')}</strong>
      </div>
      <ul>${rosterHTML}</ul>
    </div>
    <footer class="formation-actions">
      ${selfToggle}
      ${trainerActions}
    </footer>
  </article>`;
}

function renderFormations() {
  const canTrainSomething = trainableCerts().length > 0;
  $('newFormationBtn').style.display = canTrainSomething ? 'inline-flex' : 'none';
  populateFormationCertSelect();

  const list = $('formationsList');
  const formations = db.formations.all();
  $('formationsCount').textContent = formations.length;

  if (formations.length === 0) {
    list.innerHTML = `<div class="empty-state" style="padding:32px;text-align:center;">
      <div style="font-size:13px;color:var(--dim);">Aucune session programmée.</div>
      ${canTrainSomething ? '<div style="font-size:11.5px;color:var(--dim-2);margin-top:4px;">Cliquez sur <strong>+ Nouvelle session</strong> pour en créer une.</div>' : ''}
    </div>`;
    return;
  }

  // Group by state
  const now = new Date();
  const upcoming = [], todo = [], done = [];
  formations.forEach(f => {
    if (f.validated) done.push(f);
    else if (new Date(f.date) < now) todo.push(f);
    else upcoming.push(f);
  });
  upcoming.sort((a, b) => new Date(a.date) - new Date(b.date));        // soonest first
  todo.sort((a, b) => new Date(b.date) - new Date(a.date));            // most recent first
  done.sort((a, b) => (b.validatedAt || 0) - (a.validatedAt || 0));    // most recently validated

  const groups = [
    { key: 'todo',     label: 'À valider',                items: todo,     dot: 'todo' },
    { key: 'upcoming', label: 'À venir',                  items: upcoming, dot: 'upcoming' },
    { key: 'done',     label: 'Validées · historique',    items: done,     dot: 'done' },
  ].filter(g => g.items.length > 0);

  list.innerHTML = groups.map(g => `
    <div class="formations-group">
      <div class="formations-group-head">
        <span class="dot ${g.dot}"></span>
        <span>${g.label}</span>
        <span class="formations-group-count">${g.items.length}</span>
      </div>
      ${g.items.map(renderFormationCard).join('')}
    </div>
  `).join('');

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
//                       MEDICAL (casiers médicaux)
// =========================================================
let medicalSearchTerm = '';
let medicalExpanded = new Set();

function renderMedical() {
  const root = $('medicalList');
  if (!root) return;
  if (!canViewMedical) {
    root.innerHTML = '<p class="empty-state">Accès réservé aux officiers et personnel médical.</p>';
    return;
  }
  // Effectifs : on n'affiche que les utilisateurs (pas les supérieurs hors portée si pas Lt+).
  const myTier = myGrade?.tier ?? 99;
  const users = db.users.all()
    .filter(u => canViewDossier || (gradeOf(u)?.tier ?? 99) >= myTier)
    .sort((a, b) => (gradeOf(a)?.tier || 99) - (gradeOf(b)?.tier || 99));

  const term = medicalSearchTerm.trim().toLowerCase();
  const filtered = term
    ? users.filter(u => u.id.toLowerCase().includes(term))
    : users;

  $('medicalCount').textContent = `${filtered.length} effectif${filtered.length > 1 ? 's' : ''}`;

  const fitnessTag = (s) => {
    if (s === 'inapte')      return '<span class="tag" style="background:rgba(239,68,68,.15);color:#fca5a5;border-color:rgba(239,68,68,.3);">⛔ Inapte</span>';
    if (s === 'restriction') return '<span class="tag" style="background:rgba(234,179,8,.15);color:#fde047;border-color:rgba(234,179,8,.3);">⚠ Restriction</span>';
    return '<span class="tag" style="background:rgba(34,197,94,.15);color:#86efac;border-color:rgba(34,197,94,.3);">✓ Apte</span>';
  };

  root.innerHTML = filtered.map(u => {
    const m = db.medical.forUser(u.id) || { userId: u.id, fitnessStatus: 'apte' };
    const g = gradeOf(u);
    const isOpen = medicalExpanded.has(u.id);
    const updatedTxt = m.updatedAt
      ? `MAJ ${new Date(m.updatedAt).toLocaleDateString('fr-FR')}${m.updatedBy ? ' — ' + m.updatedBy : ''}`
      : 'Aucun casier';
    return `
      <div class="medical-card${isOpen ? ' is-open' : ''}" data-medical="${u.id}">
        <button class="medical-head" data-toggle-medical="${u.id}" type="button">
          <div class="mini-avatar">${initials(u.id)}</div>
          <div class="medical-id">
            <div class="mono" style="font-weight:600;">${u.id}</div>
            <div style="font-size:11px;color:var(--dim);">${g ? g.label : '—'} · ${updatedTxt}</div>
          </div>
          <div style="display:flex;gap:6px;align-items:center;">
            ${m.bloodType ? `<span class="tag" style="background:rgba(239,68,68,.15);color:#fca5a5;border-color:rgba(239,68,68,.3);">🩸 ${m.bloodType}</span>` : ''}
            ${fitnessTag(m.fitnessStatus)}
            <span class="medical-chevron">${isOpen ? '▾' : '▸'}</span>
          </div>
        </button>
        ${isOpen ? `
        <form class="medical-form" data-medical-form="${u.id}">
          <div class="medical-grid">
            <label>Groupe sanguin
              <select name="bloodType">
                <option value="">—</option>
                ${['O-','O+','A-','A+','B-','B+','AB-','AB+'].map(t => `<option value="${t}" ${m.bloodType === t ? 'selected' : ''}>${t}</option>`).join('')}
              </select>
            </label>
            <label>Aptitude
              <select name="fitnessStatus">
                <option value="apte" ${m.fitnessStatus === 'apte' ? 'selected' : ''}>Apte</option>
                <option value="restriction" ${m.fitnessStatus === 'restriction' ? 'selected' : ''}>Restriction</option>
                <option value="inapte" ${m.fitnessStatus === 'inapte' ? 'selected' : ''}>Inapte</option>
              </select>
            </label>
            <label>Dernière visite
              <input type="date" name="lastCheckup" value="${m.lastCheckup || ''}"/>
            </label>
            <label>Contact d'urgence
              <input type="text" name="emergencyContact" value="${m.emergencyContact || ''}" placeholder="Nom, téléphone…"/>
            </label>
          </div>
          <label>Allergies
            <textarea name="allergies" rows="2" placeholder="Aucune connue">${m.allergies || ''}</textarea>
          </label>
          <label>Antécédents / Pathologies
            <textarea name="conditions" rows="2">${m.conditions || ''}</textarea>
          </label>
          <label>Traitements en cours
            <textarea name="treatments" rows="2">${m.treatments || ''}</textarea>
          </label>
          <label>Notes du médecin
            <textarea name="notes" rows="3">${m.notes || ''}</textarea>
          </label>
          <div style="display:flex;gap:8px;justify-content:flex-end;">
            <button type="button" class="btn-ghost btn-sm" data-cancel-medical="${u.id}">Annuler</button>
            <button type="submit" class="btn-primary btn-sm">Enregistrer le casier</button>
          </div>
        </form>` : ''}
      </div>`;
  }).join('') || '<p class="empty-state">Aucun effectif.</p>';

  // Toggles
  root.querySelectorAll('[data-toggle-medical]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.toggleMedical;
      if (medicalExpanded.has(id)) medicalExpanded.delete(id);
      else medicalExpanded.add(id);
      renderMedical();
    });
  });
  root.querySelectorAll('[data-cancel-medical]').forEach(btn => {
    btn.addEventListener('click', () => {
      medicalExpanded.delete(btn.dataset.cancelMedical);
      renderMedical();
    });
  });
  root.querySelectorAll('[data-medical-form]').forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const userId = form.dataset.medicalForm;
      const fd = new FormData(form);
      try {
        await db.medical.upsert({
          userId,
          bloodType: fd.get('bloodType') || '',
          fitnessStatus: fd.get('fitnessStatus') || 'apte',
          lastCheckup: fd.get('lastCheckup') || null,
          emergencyContact: fd.get('emergencyContact') || '',
          allergies: fd.get('allergies') || '',
          conditions: fd.get('conditions') || '',
          treatments: fd.get('treatments') || '',
          notes: fd.get('notes') || '',
        });
        toast('Casier médical mis à jour');
        medicalExpanded.delete(userId);
        renderMedical();
      } catch (err) { /* toast déjà émis */ }
    });
  });
}

// Search wiring (idempotent — listener attaché une seule fois)
document.addEventListener('DOMContentLoaded', () => {
  const s = $('medicalSearch');
  if (s) s.addEventListener('input', (e) => {
    medicalSearchTerm = e.target.value;
    renderMedical();
  });
});

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
  renderDocs();
  if (canViewMedical) renderMedical();
  if (isCmd) renderUserAdmin();
  renderHome();
  if (currentView === 'dossier' && currentDossierUserId) renderDossier(currentDossierUserId);
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
  canManageCerts = (myGrade?.tier || 99) <= 6;
  canViewDossier = (myGrade?.tier || 99) <= 5;
  // Médical : Lt+ OU membre/lead/adj d'une spé "médic"/"tccc"
  const medSpecs = db.specializations.all().filter(s => /m[ée]dic|tccc/i.test(s.name || ''));
  canViewMedical = canViewDossier || medSpecs.some(s =>
    s.leadId === me.id || s.adjId === me.id || (s.members || []).includes(me.id)
  );

  $('viewTitle').textContent = VIEWS[currentView]?.title || 'STRIX';
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
