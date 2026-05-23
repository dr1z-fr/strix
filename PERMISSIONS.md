# STRIX — Permissions par grade et fonctionnalité

> Document de référence — reflète l'état exact des règles serveur (`api/db.js`).
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
- **Formation créée / annulée / validée** → embed dans le canal `FORMATIONS`. La validation liste les opérateurs nouvellement certifiés.

### Formations & Certifications

Les **certifications** (CQB, MED, SNI, …) sont un **catalogue** dont la création/modification/suppression est réservée au seuil **`canManageCerts`** (tier ≤ 6 = **Major et au-dessus**). Pour chaque certification, un membre de ce seuil désigne une liste de **formateurs habilités** (peu importe leur grade).

- Seul un formateur habilité (ou un `cmd`) peut **créer une formation** ciblant cette certification.
- Le formateur gère le roster comme pour une opération.
- Les opérateurs peuvent s'**inscrire eux-mêmes** tant qu'elle n'est pas validée.
- À la **validation**, tous les opérateurs marqués présents reçoivent automatiquement la certification.
- La validation est **réversible** : la dévalidation révoque les certifications délivrées par cette formation.
- Un grade `canManageCerts` peut **révoquer manuellement** une certification (`certs.revoke`).

### Documentation

Fiches de doctrine consultables par tous les opérateurs connectés. Création / modification / suppression : **`cmd` uniquement** (tier ≤ 3).

### Dossier RP & Sanctions

Les **dossiers RP** (bio, date d'incorporation, spé principale) et les **sanctions** (avertissement, blâme, …) sont :
- Visibles uniquement par **Lieutenant et au-dessus** (tier ≤ 5 = `canViewDossier`).
- Modifiables par le même seuil, **avec garde-fou hiérarchique** : on ne peut pas éditer le dossier ni infliger / supprimer une sanction visant un opérateur de tier strictement supérieur.

### Journal d'activité (Logs)

Le journal système (50 dernières entrées) est consultable par **Lieutenant et au-dessus** (tier ≤ 5). L'écriture (`log.insert`) est :
- Réservée aux utilisateurs authentifiés.
- Validée côté serveur : `pill` doit appartenir à une whitelist, `text` est tronqué à 280 caractères, le champ `who` est forcé à l'identité réelle du token (impossible de se faire passer pour un autre).

### Verrou « changement de mot de passe obligatoire »

Tant que le flag `must_change_password` est levé sur un compte, **toute action API autre que `init` et `auth.changePassword` est refusée** côté serveur (`403 must_change_password`). Le flag est posé à la création du compte ou par un `cmd` qui réassigne un nouveau code.

---

## 4. Matrice complète — qui peut faire quoi

> Colonnes : **REC** = Recrue / OP2 / OP1, **CPL** = Caporal sans `canManageOps`, **CPL+** = Caporal avec `canManageOps`, **SGT** = Sergent / Adjudant, **MAJ** = Major, **LT** = Lieutenant / Capitaine, **CMD** = Commandant / Lt-Colonel / Colonel.

### Authentification & profil personnel

| Action | REC | CPL | CPL+ | SGT | MAJ | LT | CMD |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Se connecter | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Changer son propre mot de passe | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Consulter le tableau de bord (KPI, pyramide) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Consulter l'effectif et les spécialisations | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

### Opérations

| Action | REC | CPL | CPL+ | SGT | MAJ | LT | CMD |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Toggle **sa propre** présence (op non validée) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Modifier sa présence sur une op **validée** | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Modifier le roster d'**autrui** | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Créer une opération | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Valider** une opération | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Supprimer une op **non** validée | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Dévalider** (déverrouiller) une op validée | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Supprimer** une op validée | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Éditer les **notes** d'op (manager) | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |

### Absences

| Action | REC | CPL | CPL+ | SGT | MAJ | LT | CMD |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Déclarer **sa propre** absence | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Déclarer une absence pour **autrui** | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Retirer son absence ou celle qu'il a déclarée | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Retirer **n'importe quelle** absence | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |

### Spécialisations & entraînements

| Action | REC | CPL | CPL+ | SGT | MAJ | LT | CMD |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Toggle **sa propre** présence à un entraînement (en tant que membre) | 🟡¹ | 🟡¹ | 🟡¹ | 🟡¹ | 🟡¹ | 🟡¹ | ✅ |
| Créer / supprimer un entraînement de **sa** spé (resp/adj) | 🟡² | 🟡² | 🟡² | 🟡² | 🟡² | 🟡² | ✅ |
| Modifier la liste des présents d'un entraînement | 🟡² | 🟡² | 🟡² | 🟡² | 🟡² | 🟡² | ✅ |
| Gérer les membres d'une spé (resp/adj uniquement) | 🟡² | 🟡² | 🟡² | 🟡² | 🟡² | 🟡² | ✅ |
| Créer une spécialisation | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Modifier nom / description / resp / adj d'une spé | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Supprimer une spécialisation | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

¹ Uniquement si l'opérateur est **membre / lead / adj** de la spé concernée.
² Uniquement si l'opérateur est **Responsable** ou **Adjoint** de la spé concernée.

### Certifications & formations

| Action | REC | CPL | CPL+ | SGT | MAJ | LT | CMD |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Consulter le catalogue + ses propres certifs | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| S'inscrire / se désinscrire à une formation non validée | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Créer une formation pour une certif | 🟡³ | 🟡³ | 🟡³ | 🟡³ | 🟡³ | 🟡³ | ✅ |
| Modifier le roster ou les méta-données d'une formation | 🟡³ | 🟡³ | 🟡³ | 🟡³ | 🟡³ | 🟡³ | ✅ |
| Valider / dévalider une formation (délivre les certifs) | 🟡³ | 🟡³ | 🟡³ | 🟡³ | 🟡³ | 🟡³ | ✅ |
| Supprimer une formation (créateur ou formateur) | 🟡⁴ | 🟡⁴ | 🟡⁴ | 🟡⁴ | 🟡⁴ | 🟡⁴ | ✅ |
| Créer / modifier / supprimer une certification | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌* |
| Révoquer manuellement une certification | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌* |

³ Uniquement si l'opérateur est **formateur habilité** sur la certification ciblée. Désignation par un grade `canManageCerts`.
⁴ Formateur habilité **OU** créateur de la formation **OU** `cmd`.
\* Pour la création/modif/suppression du **catalogue** des certifs et la révocation manuelle : seuil `canManageCerts` = **tier ≤ 6 (Major et plus haut)**, donc également LT, CNE, CDT, LCL, COL.

### Documentation

| Action | REC | CPL | CPL+ | SGT | MAJ | LT | CMD |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Lire les fiches de documentation | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Créer / éditer / supprimer une fiche | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

### Dossier RP & Sanctions (`canViewDossier` = tier ≤ 5)

| Action | REC | CPL | CPL+ | SGT | MAJ | LT | CMD |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Consulter le dossier RP d'un opérateur | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Modifier un dossier RP | ❌ | ❌ | ❌ | ❌ | ❌ | ✅⁵ | ✅⁵ |
| Infliger une sanction | ❌ | ❌ | ❌ | ❌ | ❌ | ✅⁵ | ✅⁵ |
| Retirer une sanction | ❌ | ❌ | ❌ | ❌ | ❌ | ✅⁵ | ✅⁵ |

⁵ Garde-fou hiérarchique : impossible d'éditer le dossier, d'infliger ou de supprimer une sanction visant un **supérieur strict**.

### Journal d'activité (Logs)

| Action | REC | CPL | CPL+ | SGT | MAJ | LT | CMD |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Consulter le journal | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Émettre une entrée de log (déclenchée par les actions) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

### Administration des utilisateurs (`isCmd`)

| Action | REC | CPL | CPL+ | SGT | MAJ | LT | CMD |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Créer un opérateur | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅⁶ |
| Éditer nom / grade / statut / `canManageOps` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅⁶ |
| Réassigner un mot de passe (force le reset) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅⁶ |
| Supprimer un opérateur | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅⁶ |
| S'auto-supprimer | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

⁶ Garde-fou hiérarchique :
- Un `cmd` ne peut **jamais** modifier ni supprimer un opérateur de **tier strictement supérieur**.
- Un `cmd` ne peut **jamais** créer ou promouvoir quiconque à un tier supérieur au sien.

---

## 5. Synthèse des seuils serveur

| Seuil | Définition | Concerne |
|---|---|---|
| `isCmd(me)` | `me.role === 'cmd'` (tier ≤ 3) | Users, Documents, Spécialisations (CRUD) |
| `canManageOps(me)` | `isCmd` **OU** flag individuel `canManageOps` | Création/validation/roster d'op, absences pour autrui |
| `canManageCerts(me)` | tier ≤ 6 (**Major+**) | Catalogue des certifications, révocation manuelle |
| `canViewDossier(me)` | tier ≤ 5 (**Lieutenant+**) | Dossier RP, sanctions, journal d'activité |
| `outranksMe(target)` | tier(target) < tier(me) | Garde-fou hiérarchique sur toute action ciblant autrui |
| `must_change_password` | flag par utilisateur | Bloque toute action API autre que `init` et `auth.changePassword` |

---

*Toutes ces règles sont **vérifiées côté serveur** dans `api/db.js`. Le frontend ne fait que les refléter — un opérateur ne peut pas les contourner en bidouillant les requêtes.*
