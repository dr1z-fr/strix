# S.T.R.I.X — Command Terminal

S.T.R.I.X est un panel paramilitaire conçu pour gérer le quotidien d'une unité fictive : opérations, présences, absences, spécialisations, entraînements, certifications et effectifs. Chaque fonctionnalité est protégée par une hiérarchie de grades et des permissions granulaires.

> 🔑 **Identifiants initiaux** : Matricule `Drui` · Mot de passe `strix2025` (changement obligatoire à la première connexion).

---

## 1. Authentification & Sécurité

- **Login sécurisé** : session par token HMAC-SHA256 signé, expiration 7 jours.
- **Changement de code obligatoire** : à la première connexion, une modale bloquante force le changement de mot de passe.
- **Hiérarchie verrouillée** : un opérateur ne peut jamais modifier, supprimer ni promouvoir au-dessus de son propre grade.

---

## 2. Tableau de bord

Vue d'ensemble de l'activité de l'unité en un coup d'œil :

- **KPI** : opérations en cours, absences actives, effectifs totaux
- **Journal d'activité** : historique en temps réel des actions (ops créées, roster modifié, absences posées, validations, etc.)
- **Pyramide des grades** : visualisation de la hiérarchie complète (Colonel → Recrue)

---

## 3. Opérations

Gestion complète des missions et de leurs effectifs :

- **Créer une opération** : nom, date, lieu, brief
- **Toggle sa présence** : chaque opérateur peut s'inscrire ou se désinscrire
- **Gestion du roster** : les manageurs (`canManageOps` ou `cmd`) peuvent inscrire/désinscrire n'importe qui
- **Validation** : quand l'opération est terminée, un manageur la valide pour figer le roster et comptabiliser les présences
- **Annulation / suppression** : suppression complète de l'opération et de ses données de présence
- **Verrouillage auto** : une fois validée, plus personne d'autre qu'un manageur ne peut toucher au roster

---

## 4. Absences

Suivi des indisponibilités de l'unité :

- **Déclarer une absence** : pour soi-même (tout le monde) ou pour un autre opérateur (manageurs uniquement)
- **Types** : Permission, Maladie, Mission, Autre
- **Suivi de durée** : date de début et de fin affichées dynamiquement
- **Retrait** : l'absence peut être retirée par son déclarant, l'opérateur concerné, ou un manageur
- **Notification cron** : chaque matin à 6h UTC, un robot notifie automatiquement les absences arrivant à terme

---

## 5. Personnel

Visualisation des effectifs et de leur profil :

- **Cartes d'identité** : photo initiale, grade, matricule, statut (actif / réserve)
- **Tableau de suivi individuel** : pour chaque opérateur
  - Grade
  - Spécialisations (avec rôle : Resp. / Adj. / Membre)
  - Certifications obtenues
  - Nombre d'opérations engagées / validées
  - Entraînements suivis
  - Absences déclarées
- **Aide à la promotion** : le tableau permet d'évaluer rapidement l'expérience d'un opérateur pour justifier une montée en grade

---

## 6. Spécialisations

Organisation de l'unité par compétences :

- **Catalogue des spés** : liste de toutes les spécialisations actives (SNIPER, MED, CQB, etc.)
- **Responsable & Adjoint** : désignés par le CMD, peuvent gérer les membres de leur spé
- **Gestion des membres** : ajout / retrait d'opérateurs (checkboxes par opérateur actif)
- **Entraînements** : sessions programmées rattachées à une spécialisation
  - Création / suppression par le Responsable, l'Adjoint, ou le CMD
  - Inscription / désinscription des membres
  - Suivi des présences

---

## 7. Formations & Certifications

Système complet de catalogage des compétences et délivrance d'attestations :

### Catalogue des certifications
- Créées par le CMD : code sigle (CQB, MED, SNI…), nom complet, description
- **Formateurs habilités** : le CMD désigne, par certification, quels opérateurs sont autorisés à former (peu importe leur grade)

### Programmer une formation
- Réservé aux formateurs habilités (et au CMD) sur la certification ciblée
- Chaque session a un intitulé, une date, un lieu et un programme
- Les opérateurs peuvent s'**auto-inscrire** via une simple checkbox
- Le formateur gère le roster (qui était présent) comme pour une opération

### Validation & Attestation
- À la fin de la session, le formateur clique **« Valider la formation »**
- Tous les opérateurs marqués présents reçoivent **automatiquement** la certification
- La validation est **réversible** : si elle est annulée, les certifications délivrées par cette formation sont révoquées
- Le CMD peut révoquer manuellement une certification à tout moment depuis le catalogue

### Mes certifications
- Chaque opérateur voit ses propres certifications sous forme de **médailles** compactes
- Affichage : code, nom complet, date d'obtention, et qui a validé

---

## 8. Administration (Commandement uniquement)

Gestion des utilisateurs réservée aux grades Direction (CMD) :

- **Créer un opérateur** : matricule, nom, grade, mot de passe initial
- **Éditer un opérateur** : modification du grade, du nom, du statut, du flag `canManageOps`
- **Supprimer un opérateur** : nettoyage automatique de ses présences dans les ops, ses entraînements, et ses formations
- **Promotion contrôlée** : un CMD ne peut jamais créer ou promouvoir au-dessus de son propre grade
- **Flag `canManageOps`** : permission individuelle activable/désactivable au cas par cas, permettant à un grade inférieur (ex. Caporal) de créer des ops et gérer le roster

---

## 9. Notifications Discord

Intégration webhooks vers plusieurs canaux Discord :

- **Opérations** : création et annulation d'opération, avec ping d'un rôle paramétrable
- **Absences** : déclaration, retrait, et fin d'absence (via cron quotidien)
- **Formations** : création d'une session, annulation, et validation avec liste des nouveaux certifiés

---

## Hiérarchie des grades

| Tier | Grade | Sigle | Groupe | Rôle | `canManageOps` |
|:---:|---|:---:|---|:---:|:---:|
| 1 | Colonel | COL | Direction | `cmd` | ✅ |
| 2 | Lieutenant-Colonel | LCL | Direction | `cmd` | ✅ |
| 3 | Commandant | CDT | Direction | `cmd` | ✅ |
| 4 | Capitaine | CNE | Officiers | `lead` | ✅ |
| 5 | Lieutenant | LT | Officiers | `lead` | ✅ |
| 6 | Major | MAJ | Sous-Officiers | `lead` | ✅ |
| 7 | Adjudant | ADJ | Sous-Officiers | `lead` | ✅ |
| 8 | Sergent | SGT | Sous-Officiers | `lead` | ✅ |
| 9 | Caporal | CPL | Militaires du Rang | `op` | ❌ |
| 10 | Opérateur 1ʳᵉ Classe | OP1 | Militaires du Rang | `op` | ❌ |
| 11 | Opérateur 2ⁿᵈᵉ Classe | OP2 | Militaires du Rang | `op` | ❌ |
| 12 | Recrue | REC | Militaires du Rang | `op` | ❌ |

---

## Matrice des permissions — vue rapide

> Colonnes : **REC** = Recrue / OP2 / OP1 · **CPL** = Caporal · **CPL+** = Caporal avec `canManageOps` · **SGT** = Sergent / Adjudant · **MAJ** = Major · **LT** = Lieutenant / Capitaine · **CMD** = Commandant / Lt-Colonel / Colonel.
> Légende : ✅ autorisé · 🟡 conditionnel · ❌ interdit.

| Fonctionnalité | REC | CPL | CPL+ | SGT | MAJ | LT | CMD |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Se connecter, changer son code, voir le tableau de bord | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Toggle sa propre présence sur une op | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Déclarer sa propre absence | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| S'inscrire à une formation non validée | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Lire la documentation | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Créer / valider / supprimer une opération | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Modifier le roster d'une op (autrui) | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Déclarer une absence pour autrui | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Gérer les membres / entraînements de **sa** spé (resp/adj) | 🟡 | 🟡 | 🟡 | 🟡 | 🟡 | 🟡 | ✅ |
| Créer une formation (formateur habilité) | 🟡 | 🟡 | 🟡 | 🟡 | 🟡 | 🟡 | ✅ |
| Valider une formation (délivre les certifs) | 🟡 | 🟡 | 🟡 | 🟡 | 🟡 | 🟡 | ✅ |
| Gérer le **catalogue** des certifications & révocations | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| Consulter le **journal d'activité** | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Voir / éditer un **dossier RP** | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Infliger / retirer une **sanction** | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Créer une **spécialisation** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Créer / éditer une fiche de **documentation** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Créer / éditer / supprimer un **opérateur** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

### Seuils techniques côté serveur

| Seuil | Définition | Couvre |
|---|---|---|
| `isCmd` | tier ≤ 3 | Administration, documentation, CRUD spés |
| `canManageOps` | flag individuel (par défaut tier ≤ 8) | Ops, absences pour autrui |
| `canManageCerts` | tier ≤ 6 (Major+) | Catalogue certifs, révocation |
| `canViewDossier` | tier ≤ 5 (Lt+) | Dossier RP, sanctions, journal |
| `outranksMe` | tier(cible) < tier(soi) | Garde-fou hiérarchique sur toute action ciblant autrui |

> 🔒 **Garde-fous hiérarchiques** appliqués partout : impossible de modifier, sanctionner, supprimer ou promouvoir au-dessus de son propre grade.
> 🔐 **Verrou de premier login** : tant que `must_change_password` est levé, seules les actions `init` et `auth.changePassword` sont autorisées par l'API.

> 📖 Pour le détail complet des permissions par action et par grade, voir [`PERMISSIONS.md`](PERMISSIONS.md).
