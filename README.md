# S.T.R.I.X — Command Terminal

Panel paramilitaire (opérations, présences, absences, spécialisations, entraînements) reposant sur :

- **Front** : HTML/CSS/JS vanilla (aucun bundler)
- **API**   : Vercel Serverless Functions (Node 18+)
- **DB**    : Postgres hébergé sur Supabase

L'identifiant initial est **Drui** (Colonel) avec le mot de passe **`strix2025`** (à changer immédiatement après le premier login). L'utilisateur est créé automatiquement par l'API si la table `users` est vide.

---

## Architecture

```
┌────────────────────────────────────────────┐
│ index.html (login)  → assets/js/auth.js    │
└─────────────────┬──────────────────────────┘
                  │ POST /api/db { action:"login" }
                  ▼
┌────────────────────────────────────────────┐
│ dashboard.html → assets/js/app.js + db.js  │
│  • cache mémoire hydraté au boot           │
│  • lectures sync, écritures optimistes     │
└─────────────────┬──────────────────────────┘
                  │ POST /api/db (Bearer token)
                  ▼
┌────────────────────────────────────────────┐
│ api/db.js (Vercel serverless)              │
│  • dispatcher unique d'actions             │
│  • contrôles de permission stricts         │
│  • pool pg singleton (max 3)               │
└─────────────────┬──────────────────────────┘
                  │ pgwire SSL
                  ▼
┌────────────────────────────────────────────┐
│ Supabase Postgres                          │
└────────────────────────────────────────────┘
```

---

## Sécurité

Toutes les actions sensibles sont **vérifiées côté serveur** dans `api/db.js`. Le frontend ne peut pas être contourné :

| Action | Qui peut ? |
|---|---|
| `users.*` | `cmd` uniquement |
| `ops.insert/delete` | `canManageOps` ou `cmd` |
| `ops.update` — `validated` | `canManageOps` ou `cmd` |
| `ops.update` — `presences` (autrui) | `canManageOps` ou `cmd` |
| `ops.update` — `presences` (soi-même) | tous |
| `absences.insert` | l'opérateur lui-même OU manageur |
| `absences.delete` | déclarant, opérateur cible, ou manageur |
| `specs.insert/delete` | `cmd` |
| `specs.update` — nom/desc/lead/adj | `cmd` |
| `specs.update` — membres | Resp., Adj. ou `cmd` |
| `trainings.*` | Resp., Adj. ou `cmd` |
| `log.insert` | tout utilisateur authentifié |

Token de session : HMAC-SHA256 signé, expire au bout de 7 jours, transmis en `Authorization: Bearer …`. Comparaison à temps constant. Statut + rôle revérifiés en DB à chaque requête (1 SELECT indexé sur clé primaire ≈ 1 ms).

Mots de passe : **bcrypt** (cost 10).

### Flag `canManageOps`

Permission individuelle, toggable par le CMD dans l'onglet **Administration**. Cochée par défaut pour les grades de tier ≤ 11 (Sergent et au-dessus). Peut être **retirée à un Sergent** ou **accordée à un Caporal** au cas par cas.

---

## Déploiement

### 1. Base de données

Dans le **SQL Editor** de Supabase, exécuter `schema.sql` une seule fois. L'utilisateur `Drui` sera bootstrappé automatiquement par l'API au premier login.

### 2. Variables d'environnement (Vercel)

```
DATABASE_URL=postgresql://postgres.PROJECT:PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres
SESSION_SECRET=<openssl rand -hex 32>
```

> **Important pour le free tier** : utiliser le **Connection Pooler** de Supabase (port `6543`, mode transaction). En direct (port `5432`), les fonctions serverless saturent rapidement les connexions disponibles.

### 3. Déploiement

```bash
npm install
npx vercel --prod
```

Ou pousser sur un repo Git connecté à Vercel.

### 4. Dev local

```bash
cp .env.example .env
npm install
npx vercel dev
```

Disponible sur http://localhost:3000.

---

## Optimisations free tier

| Optimisation | Effet |
|---|---|
| **Init en une requête** | Toutes les tables hydratées en 1 invocation (6 queries `Promise.all`) |
| **Cache mémoire client** | Aucun refetch pour les lectures — uniquement pour les écritures |
| **Updates optimistes** | UI réactive sans round-trip ; rollback en cas d'erreur API |
| **Pool pg singleton** | Réutilisation des connexions sur les invocations chaudes |
| **`max: 3` sur le pool** | Limite la pression sur le Supabase pooler |
| **CTE log insert + trim** | Insertion + nettoyage en 1 round-trip au lieu de 2 |
| **Cleanup user en transaction** | 1 invocation supprime user + nettoie ops/specs/trainings |
| **Token avec claims** | Évite des lectures DB côté API (1 query seulement par requête, sur PK) |
| **`Cache-Control: no-store`** | Pas de gaspillage CDN sur l'API (qui mute) ; statiques restent cachés |
| **Aucune dépendance front** | Pas de build, payload minimal (~25 KB JS gzip) |

Charge estimée pour une équipe de 50 opérateurs très actifs :
- ~5–10 invocations / utilisateur / session
- ~30 KB DB / utilisateur
- Largement dans les limites du free tier Vercel (100k invocations/mois) et Supabase (500 MB / 2 GB).

---

## Premier login

1. Ouvrir `/`
2. Matricule : `Drui` — Mot de passe : `strix2025`
3. Aller dans **Administration** → s'éditer soi-même pour changer le code d'accès
4. Créer le reste de l'équipe
