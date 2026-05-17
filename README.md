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

Toutes les actions sensibles sont **vérifiées côté serveur** dans `api/db.js`. Le frontend ne peut pas être contourné.

Token de session : HMAC-SHA256 signé, expire au bout de 7 jours, transmis en `Authorization: Bearer …`. Comparaison à temps constant. Statut + rôle revérifiés en DB à chaque requête (1 SELECT indexé sur clé primaire ≈ 1 ms).

Mots de passe : **bcrypt** (cost 10). Changement de code obligatoire à la première connexion.

---

## Hiérarchie des grades

| Tier | Grade | Sigle | Groupe | Rôle système | `canManageOps` par défaut |
|:---:|---|:---:|---|:---:|:---:|
| 1 | Colonel              | COL | Direction          | `cmd`  | ✅ |
| 2 | Lieutenant-Colonel   | LCL | Direction          | `cmd`  | ✅ |
| 3 | Commandant           | CDT | Direction          | `cmd`  | ✅ |
| 4 | Capitaine            | CNE | Officiers          | `lead` | ✅ |
| 5 | Lieutenant           | LT  | Officiers          | `lead` | ✅ |
| 6 | Major                | MAJ | Sous-Officiers     | `lead` | ✅ |
| 7 | Adjudant             | ADJ | Sous-Officiers     | `lead` | ✅ |
| 8 | Sergent              | SGT | Sous-Officiers     | `lead` | ✅ |
| 9 | Caporal              | CPL | Militaires du Rang | `op`   | ❌ |
| 10 | Opérateur 1ʳᵉ Classe | OP1 | Militaires du Rang | `op`   | ❌ |
| 11 | Opérateur 2ⁿᵈᵉ Classe| OP2 | Militaires du Rang | `op`   | ❌ |
| 12 | Recrue               | REC | Militaires du Rang | `op`   | ❌ |

> **Tier 1 = grade le plus haut.** Un opérateur ne peut jamais modifier, supprimer, ni promouvoir au-dessus de son propre tier (vérifié API + UI).

### Rôles système

- **`cmd`** (tier 1–3) : Direction. Accès complet à l'administration (utilisateurs, spécialisations, etc.).
- **`lead`** (tier 4–8) : Officiers + Sous-Officiers. Encadrement opérationnel. Reçoit `canManageOps` par défaut.
- **`op`** (tier 9–12) : Militaires du Rang. Accès opérationnel basique (présences, ses propres absences).

### Flag `canManageOps`

Permission individuelle togglable par le CMD dans **Administration**. Cochée par défaut pour les tiers ≤ 8 (Sergent et au-dessus). Peut être **retirée à un Sergent** ou **accordée à un Caporal** au cas par cas — dissocie la responsabilité opérationnelle du grade.

---

## Matrice des permissions

Légende : ✅ autorisé · 🟡 conditionnel · ❌ interdit

### Vue par action API

| Action | `op` | `op + canManageOps` | `lead` | `cmd` |
|---|:---:|:---:|:---:|:---:|
| **Lecture** (`init`) | ✅ | ✅ | ✅ | ✅ |
| **Auth** — changer son propre code (`auth.changePassword`) | ✅ | ✅ | ✅ | ✅ |
| **Logs** — écrire (`log.insert`) | ✅ | ✅ | ✅ | ✅ |
| **Ops** — créer (`ops.insert`) | ❌ | ✅ | ✅ | ✅ |
| **Ops** — supprimer (`ops.delete`) | ❌ | ✅ | ✅ | ✅ |
| **Ops** — valider/dévalider (`ops.update.validated`) | ❌ | ✅ | ✅ | ✅ |
| **Ops** — toggle sa propre présence | ✅ 🟡 | ✅ | ✅ | ✅ |
| **Ops** — modifier la présence d'autrui | ❌ | ✅ | ✅ | ✅ |
| **Absences** — déclarer la sienne | ✅ | ✅ | ✅ | ✅ |
| **Absences** — déclarer pour autrui | ❌ | ✅ | ✅ | ✅ |
| **Absences** — retirer | 🟡¹ | 🟡¹ ✅ | ✅ | ✅ |
| **Spécialisations** — CRUD (créer/supprimer/méta) | ❌ | ❌ | ❌ | ✅ |
| **Spécialisations** — gérer les membres | 🟡² | 🟡² | 🟡² | ✅ |
| **Entraînements** — créer/supprimer | 🟡² | 🟡² | 🟡² | ✅ |
| **Utilisateurs** — créer/éditer/supprimer | ❌ | ❌ | ❌ | ✅ ³ |

🟡 conditions :
1. Une absence ne peut être retirée que par : son **déclarant**, l'**opérateur concerné**, ou un manageur (`canManageOps` / `cmd`).
2. Réservé au **Responsable** ou **Adjoint** de la spécialisation concernée (peu importe le grade), ou au `cmd`.
3. Le `cmd` ne peut **jamais** modifier ni supprimer un opérateur de tier strictement supérieur, ni promouvoir quiconque à un tier supérieur au sien (un `Commandant` ne peut pas créer un `Colonel`).

🟡 ops self-toggle : si l'op est déjà **validée**, plus personne d'autre qu'un manageur ne peut toucher au roster (`op_locked`).

### Vue par grade

| Capacité | Recrue → OP2 | Caporal | Sergent → Major | Lieutenant → Capitaine | Commandant → Colonel |
|---|:---:|:---:|:---:|:---:|:---:|
| Voir le panel & ses propres infos | ✅ | ✅ | ✅ | ✅ | ✅ |
| Toggle sa présence sur les ops | ✅ | ✅ | ✅ | ✅ | ✅ |
| Déclarer / retirer ses absences | ✅ | ✅ | ✅ | ✅ | ✅ |
| Créer / annuler des opérations | ❌ | ❌ ⁴ | ✅ | ✅ | ✅ |
| Valider une op et son roster | ❌ | ❌ ⁴ | ✅ | ✅ | ✅ |
| Déclarer une absence pour autrui | ❌ | ❌ ⁴ | ✅ | ✅ | ✅ |
| Gérer les membres d'une spécialisation | ❌ ⁵ | ❌ ⁵ | ❌ ⁵ | ❌ ⁵ | ✅ |
| Créer / supprimer une spécialisation | ❌ | ❌ | ❌ | ❌ | ✅ |
| Créer / éditer / supprimer un opérateur | ❌ | ❌ | ❌ | ❌ | ✅ ³ |
| Modifier le flag `canManageOps` d'un opérateur | ❌ | ❌ | ❌ | ❌ | ✅ |

⁴ Sauf si le `cmd` lui a accordé manuellement le flag `canManageOps`.  
⁵ Sauf si l'opérateur est désigné **Responsable** ou **Adjoint** de cette spécialisation, peu importe son grade.

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
