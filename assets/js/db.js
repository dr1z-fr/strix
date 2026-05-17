/* =========================================================
   STRIX // CLIENT DATA LAYER
   In-memory cache hydrated from /api/db (Postgres via Vercel).
   Reads are sync from cache.
   Writes apply optimistically to the cache, then are persisted
   to the backend asynchronously.
   ========================================================= */
(function () {
  const TOKEN_KEY = 'strix:token';
  const REMEMBER_KEY = 'strix:remember';
  const API_URL = '/api/db';

  // ---- Grade hierarchy (frontend-only catalog) ----
  const GRADES = [
    { key: 'colonel',           label: 'Colonel',              short: 'COL',  appel: 'Mon Colonel',     group: 'Direction',        role: 'cmd',  tier: 1 },
    { key: 'lt-colonel',        label: 'Lieutenant-Colonel',   short: 'LCL',  appel: 'Mon Colonel',     group: 'Direction',        role: 'cmd',  tier: 2 },
    { key: 'commandant',        label: 'Commandant',           short: 'CDT',  appel: 'Mon Commandant',  group: 'Direction',        role: 'cmd',  tier: 3 },

    { key: 'capitaine',         label: 'Capitaine',            short: 'CNE',  appel: 'Mon Capitaine',   group: 'Officiers',        role: 'lead', tier: 4 },
    { key: 'lieutenant',        label: 'Lieutenant',           short: 'LT',   appel: 'Mon Lieutenant',  group: 'Officiers',        role: 'lead', tier: 5 },
    { key: 'sous-lieutenant',   label: 'Sous-Lieutenant',      short: 'SLT',  appel: 'Mon Lieutenant',  group: 'Officiers',        role: 'lead', tier: 6 },

    { key: 'major',             label: 'Major',                short: 'MAJ',  appel: 'Major',           group: 'Sous-Officiers',   role: 'lead', tier: 7 },
    { key: 'adjudant-chef',     label: 'Adjudant-chef',        short: 'ADC',  appel: 'Chef',            group: 'Sous-Officiers',   role: 'lead', tier: 8 },
    { key: 'adjudant',          label: 'Adjudant',             short: 'ADJ',  appel: 'Chef',            group: 'Sous-Officiers',   role: 'lead', tier: 9 },
    { key: 'sergent-chef',      label: 'Sergent-chef',         short: 'SCH',  appel: 'Chef',            group: 'Sous-Officiers',   role: 'lead', tier: 10 },
    { key: 'sergent',           label: 'Sergent',              short: 'SGT',  appel: 'Sergent',         group: 'Sous-Officiers',   role: 'lead', tier: 11 },

    { key: 'caporal-chef',      label: 'Caporal-Chef',         short: 'CCH',  appel: 'Caporal-chef',    group: 'Militaires du Rang', role: 'op', tier: 12 },
    { key: 'caporal',           label: 'Caporal',              short: 'CPL',  appel: 'Caporal',         group: 'Militaires du Rang', role: 'op', tier: 13 },
    { key: 'operateur-1cl',     label: 'Opérateur 1ère Classe', short: 'OP1', appel: 'Opérateur',       group: 'Militaires du Rang', role: 'op', tier: 14 },
    { key: 'operateur-2cl',     label: 'Opérateur 2nde Classe', short: 'OP2', appel: 'Opérateur',       group: 'Militaires du Rang', role: 'op', tier: 15 },
    { key: 'soldat-2cl',        label: 'Soldat 2nde Classe',   short: 'SDT',  appel: 'Soldat',          group: 'Militaires du Rang', role: 'op', tier: 16 },
    { key: 'recrue',            label: 'Recrue',               short: 'REC',  appel: 'Recrue',          group: 'Militaires du Rang', role: 'op', tier: 17 },
  ];
  const GRADE_GROUPS = ['Direction', 'Officiers', 'Sous-Officiers', 'Militaires du Rang'];
  const gradeByKey = key => GRADES.find(g => g.key === key) || null;

  // ---- Token storage ----
  const tokenStore = {
    get() {
      return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || null;
    },
    set(token, remember) {
      const target = remember ? localStorage : sessionStorage;
      target.setItem(TOKEN_KEY, token);
      if (remember) localStorage.setItem(REMEMBER_KEY, '1');
    },
    clear() {
      localStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(REMEMBER_KEY);
    },
  };

  // ---- Error code → human message ----
  const ERROR_MAP = {
    forbidden: 'Action interdite',
    forbidden_higher_rank: 'Impossible : opérateur de rang supérieur',
    forbidden_validate: 'Validation interdite',
    forbidden_roster: 'Modification du roster interdite',
    forbidden_members: 'Gestion des membres interdite',
    forbidden_meta: 'Modification réservée au commandement',
    op_locked: 'Opération verrouillée',
    cannot_delete_self: 'Impossible de se supprimer soi-même',
    not_found: 'Élément introuvable',
    session_invalid: 'Session invalide',
    unauthorized: 'Non autorisé',
  };
  function humanError(code) { return ERROR_MAP[code] || code; }

  // ---- API helper ----
  async function api(action, payload) {
    const headers = { 'Content-Type': 'application/json' };
    const token = tokenStore.get();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action, ...payload }),
    });
    if (res.status === 401 && action !== 'login') {
      tokenStore.clear();
      if (!location.pathname.endsWith('index.html') && location.pathname !== '/') {
        location.href = 'index.html';
      }
      throw new Error('unauthorized');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `http_${res.status}`);
    return data;
  }

  // ---- In-memory cache ----
  const cache = {
    me: null,
    users: [],
    ops: [],
    absences: [],
    specializations: [],
    trainings: [],
    log: [],
  };

  let renderCallback = null;
  function setRenderCallback(fn) { renderCallback = fn; }
  function triggerRender() {
    if (typeof renderCallback === 'function') {
      try { renderCallback(); } catch (e) { console.error(e); }
    }
  }

  function uid() {
    return 'id_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  // ---- Generic collection (sync reads on cache, async writes via API) ----
  function makeCollection(name, apiPrefix) {
    return {
      all: () => cache[name].slice(),
      find: (id) => cache[name].find(x => x.id === id) || null,
      where: (pred) => cache[name].filter(pred),

      async insert(record) {
        if (!record.id) record.id = uid();
        cache[name].push(record);
        triggerRender();
        try { await api(`${apiPrefix}.insert`, { record }); }
        catch (err) {
          // Rollback on failure
          const i = cache[name].findIndex(x => x.id === record.id);
          if (i !== -1) cache[name].splice(i, 1);
          triggerRender();
          window.STRIX?.toast?.(humanError(err.message));
          throw err;
        }
        return record;
      },

      async update(id, patch) {
        const i = cache[name].findIndex(x => x.id === id);
        if (i === -1) return null;
        const prev = cache[name][i];
        cache[name][i] = { ...prev, ...patch };
        triggerRender();
        try { await api(`${apiPrefix}.update`, { id, patch }); }
        catch (err) {
          cache[name][i] = prev;
          triggerRender();
          window.STRIX?.toast?.(humanError(err.message));
          throw err;
        }
        return cache[name][i];
      },

      async delete(id) {
        const i = cache[name].findIndex(x => x.id === id);
        if (i === -1) return false;
        const prev = cache[name][i];
        cache[name].splice(i, 1);
        triggerRender();
        try { await api(`${apiPrefix}.delete`, { id }); }
        catch (err) {
          cache[name].splice(i, 0, prev);
          triggerRender();
          window.STRIX?.toast?.(humanError(err.message));
          throw err;
        }
        return true;
      },

      // Replace all entries (used by seed-like sync). Server-only.
      setAll(list) {
        cache[name] = list.slice();
        triggerRender();
      },
    };
  }

  // ---- Specialized collections ----
  const users     = makeCollection('users',           'users');
  const ops       = makeCollection('ops',             'ops');
  const absences  = makeCollection('absences',        'absences');
  const specs     = makeCollection('specializations', 'specs');
  const trainings = makeCollection('trainings',       'trainings');

  // log: insert-only, optimistic, no rollback semantics
  const log = {
    all: () => cache.log.slice(),
    where: pred => cache.log.filter(pred),
    setAll: list => { cache.log = list.slice(); triggerRender(); },
    async insert(record) {
      const entry = { id: 'tmp_' + uid(), ts: Date.now(), ...record };
      cache.log.unshift(entry);
      if (cache.log.length > 50) cache.log.length = 50;
      triggerRender();
      try { await api('log.insert', { record: entry }); }
      catch (e) { /* silent */ }
    },
  };

  // ---- Init: hydrate cache from server ----
  async function init() {
    if (!tokenStore.get()) return false;
    try {
      const data = await api('init', {});
      cache.me = data.me;
      cache.users           = data.users || [];
      cache.ops             = data.ops || [];
      cache.absences        = data.absences || [];
      cache.specializations = data.specializations || [];
      cache.trainings       = data.trainings || [];
      cache.log             = data.log || [];
      return true;
    } catch (err) {
      return false;
    }
  }

  // ---- Auth API ----
  const auth = {
    async login(id, password, remember) {
      const data = await api('login', { id, password });
      tokenStore.set(data.token, remember);
      cache.me = data.user;
      return data.user;
    },
    logout() {
      tokenStore.clear();
      cache.me = null;
      cache.users = [];
      cache.ops = [];
      cache.absences = [];
      cache.specializations = [];
      cache.trainings = [];
      cache.log = [];
    },
    me() { return cache.me; },
    isAuthenticated() { return !!tokenStore.get(); },
  };

  // ---- Public API ----
  window.STRIX = window.STRIX || {};
  window.STRIX.db = {
    users, ops, absences,
    specializations: specs,
    trainings, log,
    auth,
    init,
    setRenderCallback,
    uid,
    grades: GRADES,
    gradeGroups: GRADE_GROUPS,
    gradeByKey,
  };
})();
