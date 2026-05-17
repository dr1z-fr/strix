/* === STRIX // AUTH GATE === */
const db = STRIX.db;
const form = document.getElementById('loginForm');
const errorBox = document.getElementById('loginError');
const submitBtn = form.querySelector('button[type="submit"]');

// Already authenticated? Redirect to dashboard.
if (db.auth.isAuthenticated()) {
  window.location.href = 'dashboard.html';
}

const ERROR_MAP = {
  invalid_credentials: 'Authentification refusée — Matricule ou code invalide',
  reserve: 'Compte en réserve — Accès non autorisé',
  missing_fields: 'Champs manquants',
  unauthorized: 'Session expirée',
};

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('username').value.trim();
  const pwd = document.getElementById('password').value;
  const remember = document.getElementById('remember').checked;

  if (!id || !pwd) return;

  errorBox.hidden = true;
  submitBtn.disabled = true;
  const originalLabel = submitBtn.innerHTML;
  submitBtn.textContent = 'Connexion en cours…';

  try {
    await db.auth.login(id, pwd, remember);
    submitBtn.textContent = 'Accès accordé';
    setTimeout(() => { window.location.href = 'dashboard.html'; }, 250);
  } catch (err) {
    errorBox.textContent = ERROR_MAP[err.message] || `Erreur — ${err.message}`;
    errorBox.hidden = false;
    document.getElementById('password').value = '';
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalLabel;
  }
});
