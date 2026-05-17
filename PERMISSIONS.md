# STRIX — Permissions par grade

> Document de référence pour les opérateurs et chefs d'équipe.
> Légende : ✅ autorisé · 🟡 conditionnel (voir notes) · ❌ interdit.

---

## 1. Hiérarchie

**Tier 1 = grade le plus élevé.** Plus le tier est bas, plus le grade est haut.

| Tier | Grade | Sigle | Groupe | Rôle système | `canManageOps` par défaut |
|:---:|---|:---:|---|:---:|:---:|
| 1  | Colonel              | COL | Direction          | `cmd`  | ✅ |
| 2  | Lieutenant-Colonel   | LCL | Direction          | `cmd`  | ✅ |
| 3  | Commandant           | CDT | Direction          | `cmd`  | ✅ |
| 4  | Capitaine            | CNE | Officiers          | `lead` | ✅ |
| 5  | Lieutenant           | LT  | Officiers          | `lead` | ✅ |
| 6  | Major                | MAJ | Sous-Officiers     | `lead` | ✅ |
| 7  | Adjudant             | ADJ | Sous-Officiers     | `lead` | ✅ |
| 8  | Sergent              | SGT | Sous-Officiers     | `lead` | ✅ |
| 9  | Caporal              | CPL | Militaires du Rang | `op`   | ❌ |
| 10 | Opérateur 1ʳᵉ Classe | OP1 | Militaires du Rang | `op`   | ❌ |
| 11 | Opérateur 2ⁿᵈᵉ Classe | OP2 | Militaires du Rang | `op`   | ❌ |
| 12 | Recrue               | REC | Militaires du Rang | `op`   | ❌ |

### Rôles système

- **`cmd`** (tier 1–3) — Direction. Accès complet à l'administration.
- **`lead`** (tier 4–8) — Officiers + Sous-Officiers. Encadrement opérationnel. `canManageOps` ✅ par défaut.
- **`op`** (tier 9–12) — Militaires du Rang. Accès opérationnel basique.

### Flag `canManageOps`

Permission **individuelle** togglable par le `cmd` dans **Administration**. Décorrélée du grade :

- Cochée par défaut pour tier ≤ 8 (Sergent et au-dessus).
- Peut être **retirée** à un Sergent (devient `lead` sans pouvoir gérer les ops).
- Peut être **accordée** à un Caporal (reste `op` mais peut gérer les ops).

---

## 2. Matrice détaillée par grade

### 2.1 Recrue · Opérateur 2ⁿᵈᵉ Cl · Opérateur 1ʳᵉ Cl
*(tier 10–12 — `op`, `canManageOps` désactivé par défaut)*

| Capacité | |
|---|:---:|
| Se connecter et changer son propre code d'accès | ✅ |
| Consulter les opérations, l'effectif, les spécialisations | ✅ |
| **Toggle sa propre présence** sur une opération non validée | ✅ |
| Modifier sa présence sur une op **validée** | ❌ (verrouillée) |
| Modifier la présence d'un autre opérateur | ❌ |
| **Déclarer une de ses propres absences** | ✅ |
| Retirer une absence (la sienne, ou celle qu'il a déclarée) | ✅ |
| Déclarer une absence pour quelqu'un d'autre | ❌ |
| Créer / annuler / valider une opération | ❌ |
| Gérer les membres ou entraînements d'une spécialisation | 🟡 ¹ |
| Gérer les utilisateurs (créer/éditer/supprimer) | ❌ |

¹ Uniquement s'il est désigné **Responsable** ou **Adjoint** de la spécialisation concernée.

---

### 2.2 Caporal
*(tier 9 — `op`, `canManageOps` désactivé par défaut)*

Identique à 2.1, **sauf** :

- Si le `cmd` lui octroie `canManageOps`, il acquiert toutes les capacités opérationnelles d'un `lead` (création/annulation/validation d'op, gestion roster, déclaration d'absences pour autrui).

---

### 2.3 Sergent · Adjudant · Major
*(tier 6–8 — `lead`, `canManageOps` activé par défaut)*

| Capacité | |
|---|:---:|
| Tout ce qu'un opérateur peut faire | ✅ |
| **Créer une opération** | ✅ |
| **Annuler une opération** (déclenche un embed Discord) | ✅ |
| **Valider / dévalider** une opération (verrouille le roster) | ✅ |
| Modifier la présence de n'importe quel opérateur | ✅ |
| Déclarer une absence pour un autre opérateur | ✅ |
| Retirer n'importe quelle absence | ✅ |
| Gérer les membres / entraînements d'une spé | 🟡 ¹ |
| Gérer les utilisateurs | ❌ |
| Modifier le grade ou le flag `canManageOps` d'autrui | ❌ |

¹ Uniquement Responsable ou Adjoint de la spé concernée.

---

### 2.4 Lieutenant · Capitaine
*(tier 4–5 — `lead`, `canManageOps` activé par défaut)*

Identique à 2.3 — pas de privilège supplémentaire vs Sergent/Adjudant/Major **côté technique**. Le grade reste un marqueur de hiérarchie (un Capitaine ne peut pas être modifié par un Sergent).

---

### 2.5 Commandant · Lieutenant-Colonel · Colonel
*(tier 1–3 — `cmd`)*

| Capacité | |
|---|:---:|
| Tout ce qu'un `lead` peut faire | ✅ |
| **Créer un opérateur** | ✅ ² |
| **Éditer un opérateur** (nom, grade, statut, code, `canManageOps`) | ✅ ² |
| **Supprimer un opérateur** | ✅ ² |
| Forcer le changement de mot de passe (en assignant un nouveau code) | ✅ |
| **Créer / supprimer une spécialisation** | ✅ |
| Désigner les Responsables / Adjoints de spé | ✅ |
| Gérer les membres et entraînements de **toutes** les spés | ✅ |

² **Garde-fou hiérarchique :**
- Un `cmd` ne peut **jamais** modifier ni supprimer un opérateur de **tier strictement supérieur** (un Commandant ne peut pas toucher à un Colonel).
- Un `cmd` ne peut **jamais** créer ou promouvoir quiconque à un tier supérieur au sien (un Commandant ne peut pas créer un Lt-Colonel).
- L'auto-modification est autorisée (s'éditer soi-même).
- L'auto-suppression est interdite (`cannot_delete_self`).

---

## 3. Cas particuliers

### Opération verrouillée
Une fois qu'un manageur a cliqué sur **Valider**, l'opération est verrouillée :
- Plus personne, pas même l'opérateur lui-même, ne peut modifier le roster.
- Seul un manageur (`lead` / `cmd` avec `canManageOps`) peut **dévalider** pour rouvrir le roster.

### Suppression d'absence
Une absence ne peut être supprimée que par :
- Le **déclarant** (celui qui l'a posée).
- L'**opérateur cible** (la personne absente).
- Un manageur (`canManageOps` ou `cmd`).

### Spécialisations & entraînements
Les **Responsables (lead)** et **Adjoints (adj)** d'une spécialisation peuvent gérer les membres et entraînements de **leur** spé, peu importe leur grade.
Un `cmd` peut tout faire sur **toutes** les spés.

### Première connexion
Tout nouvel opérateur (créé par le `cmd`) doit changer son code d'accès à sa première connexion (modale bloquante). Idem si le `cmd` lui réassigne un nouveau mot de passe.

### Notifications Discord
- **Op créée / annulée** → embed dans le canal `OPS` + ping du rôle `<@&1432712716589465763>`.
- **Absence posée / retirée / terminée** → embed dans le canal `ABSENCES` (sans ping).
- Les "fins d'absence" sont notifiées par un cron quotidien à 06:00 UTC.

---

## 4. Résumé — qui peut faire quoi en une page

| Action | REC · OP2 · OP1 | CPL | CPL+canMgOps | SGT · ADJ · MAJ | LT · CNE | CDT · LCL · COL |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Toggle sa présence | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Déclarer ses absences | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Créer/annuler une op | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Valider une op | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Modifier roster d'autrui | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Absence pour autrui | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Gérer membres de SA spé (resp/adj) | 🟡 | 🟡 | 🟡 | 🟡 | 🟡 | ✅ |
| Créer/supprimer une spé | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Créer/éditer/supprimer un opérateur | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

---

*Toutes ces règles sont **vérifiées côté serveur** dans `api/db.js`. Le frontend ne fait que les refléter — un opérateur ne peut pas les contourner en bidouillant les requêtes.*
