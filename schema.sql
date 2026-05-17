-- =========================================================
-- STRIX // SUPABASE POSTGRES SCHEMA
-- À exécuter une seule fois dans le SQL Editor Supabase.
-- =========================================================

CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  password_hash   TEXT NOT NULL,
  name            TEXT NOT NULL,
  grade           TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('cmd','lead','op')),
  status          TEXT NOT NULL DEFAULT 'actif' CHECK (status IN ('actif','reserve')),
  can_manage_ops  BOOLEAN NOT NULL DEFAULT FALSE,
  must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
-- Migrations : ajout des colonnes pour les bases existantes
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_manage_ops BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

-- Migration : remapping des grades supprimés (rétrogradation au grade immédiatement inférieur encore existant)
UPDATE users SET grade = 'lieutenant'   WHERE grade = 'sous-lieutenant';
UPDATE users SET grade = 'adjudant'     WHERE grade = 'adjudant-chef';
UPDATE users SET grade = 'sergent'      WHERE grade = 'sergent-chef';
UPDATE users SET grade = 'caporal'      WHERE grade = 'caporal-chef';
UPDATE users SET grade = 'operateur-2cl' WHERE grade = 'soldat-2cl';

CREATE TABLE IF NOT EXISTS ops (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  date          TIMESTAMPTZ NOT NULL,
  zone          TEXT NOT NULL,
  priority      TEXT NOT NULL,
  brief         TEXT,
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  presences     JSONB NOT NULL DEFAULT '{}'::jsonb,
  validated     BOOLEAN NOT NULL DEFAULT false,
  validated_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ops_date_idx ON ops (date);

CREATE TABLE IF NOT EXISTS absences (
  id           TEXT PRIMARY KEY,
  operator     TEXT REFERENCES users(id) ON DELETE CASCADE,
  from_date    DATE NOT NULL,
  to_date      DATE NOT NULL,
  reason       TEXT NOT NULL,
  comment      TEXT,
  declared_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  ts           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  end_notified BOOLEAN NOT NULL DEFAULT FALSE
);
ALTER TABLE absences ADD COLUMN IF NOT EXISTS end_notified BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS absences_end_idx ON absences (to_date) WHERE end_notified = false;

CREATE TABLE IF NOT EXISTS specializations (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT,
  lead_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  adj_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  members      JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trainings (
  id           TEXT PRIMARY KEY,
  spec_id      TEXT REFERENCES specializations(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  date         TIMESTAMPTZ NOT NULL,
  description  TEXT,
  attendees    JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================================
-- CERTIFICATIONS & FORMATIONS
-- =========================================================
CREATE TABLE IF NOT EXISTS certifications (
  id           TEXT PRIMARY KEY,
  code         TEXT NOT NULL,            -- ex: CQB, MED, SNI
  name         TEXT NOT NULL,            -- ex: Close Quarter Battle
  description  TEXT,
  trainers     JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [userId, ...]
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS formations (
  id            TEXT PRIMARY KEY,
  cert_id       TEXT REFERENCES certifications(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  date          TIMESTAMPTZ NOT NULL,
  location      TEXT,
  description   TEXT,
  attendees     JSONB NOT NULL DEFAULT '{}'::jsonb,  -- { userId: bool }
  validated     BOOLEAN NOT NULL DEFAULT FALSE,
  validated_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  validated_at  TIMESTAMPTZ,
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS formations_cert_idx ON formations (cert_id);
CREATE INDEX IF NOT EXISTS formations_date_idx ON formations (date DESC);

CREATE TABLE IF NOT EXISTS cert_holders (
  cert_id      TEXT REFERENCES certifications(id) ON DELETE CASCADE,
  user_id      TEXT REFERENCES users(id) ON DELETE CASCADE,
  awarded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  awarded_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  formation_id TEXT REFERENCES formations(id) ON DELETE SET NULL,
  PRIMARY KEY (cert_id, user_id)
);
CREATE INDEX IF NOT EXISTS cert_holders_user_idx ON cert_holders (user_id);

CREATE TABLE IF NOT EXISTS log (
  id    BIGSERIAL PRIMARY KEY,
  ts    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  text  TEXT NOT NULL,
  pill  TEXT,
  who   TEXT
);
CREATE INDEX IF NOT EXISTS log_ts_idx ON log (ts DESC);

-- L'utilisateur initial "Drui" (Colonel) sera créé automatiquement par
-- l'API au premier login si la table users est vide.
-- Mot de passe par défaut : strix2025
