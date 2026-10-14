-- ============================================================
-- Company Digital Twin — PostgreSQL Schema
-- Phase 4 · Multi-Tenant & Data Sync
--
-- Designed for multi-tenant isolation via company_id foreign keys
-- and Row-Level Security (RLS).  Run this file against a fresh
-- database or wrap in a migration tool (e.g. node-pg-migrate).
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ──────────────────────────────────
--  1. COMPANIES (tenants)
-- ──────────────────────────────────

CREATE TABLE companies (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(255) NOT NULL,
  slug        VARCHAR(100) NOT NULL UNIQUE, -- URL-friendly identifier
  logo_url    TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_companies_slug ON companies (slug);

-- ──────────────────────────────────
--  2. USERS
-- ──────────────────────────────────

CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  email       VARCHAR(320) NOT NULL,
  display_name VARCHAR(100),
  role        VARCHAR(30)  NOT NULL DEFAULT 'editor',
    -- roles: 'admin', 'editor', 'viewer'
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  UNIQUE (company_id, email)
);

CREATE INDEX idx_users_company ON users (company_id);

-- ──────────────────────────────────
--  3. WORKSPACE LAYOUTS
-- ──────────────────────────────────

CREATE TABLE workspace_layouts (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  name         VARCHAR(255) NOT NULL DEFAULT 'Untitled Layout',
  version      INTEGER      NOT NULL DEFAULT 1,
  is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
  created_by   UUID         REFERENCES users (id) ON DELETE SET NULL,
  metadata     JSONB        NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_layouts_company  ON workspace_layouts (company_id);
CREATE INDEX idx_layouts_active   ON workspace_layouts (company_id, is_active);

-- ──────────────────────────────────
--  4. ROOMS
-- ──────────────────────────────────

CREATE TABLE rooms (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  layout_id    UUID         NOT NULL REFERENCES workspace_layouts (id) ON DELETE CASCADE,
  company_id   UUID         NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  -- Denormalised company_id makes RLS policies simpler & avoids JOINs.

  type         VARCHAR(50)  NOT NULL DEFAULT 'OFFICE',
  name         VARCHAR(255) NOT NULL,
  x            REAL         NOT NULL DEFAULT 0,
  z            REAL         NOT NULL DEFAULT 0,
  width        REAL         NOT NULL DEFAULT 6,
  depth        REAL         NOT NULL DEFAULT 5,
  wall_height  REAL         NOT NULL DEFAULT 3,
  color        VARCHAR(9)   NOT NULL DEFAULT '#4a7dff',
  doors        JSONB        NOT NULL DEFAULT '[]',
    -- e.g. [{ "wall": "north", "offset": 0, "width": 1.2 }]
  sort_order   INTEGER      NOT NULL DEFAULT 0,

  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rooms_layout  ON rooms (layout_id);
CREATE INDEX idx_rooms_company ON rooms (company_id);

-- ──────────────────────────────────
--  5. OBJECTS
-- ──────────────────────────────────

CREATE TABLE objects (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  layout_id    UUID         NOT NULL REFERENCES workspace_layouts (id) ON DELETE CASCADE,
  company_id   UUID         NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  room_id      UUID         REFERENCES rooms (id) ON DELETE SET NULL,
    -- NULL = placed on the ground plane but not inside any room

  asset_type   VARCHAR(80)  NOT NULL,  -- key from ASSET_TYPES catalog
  category     VARCHAR(50)  NOT NULL DEFAULT 'Furniture',
  name         VARCHAR(255) NOT NULL,

  -- Transform (3-axis position, rotation in radians, uniform/non-uniform scale)
  pos_x        REAL NOT NULL DEFAULT 0,
  pos_y        REAL NOT NULL DEFAULT 0,
  pos_z        REAL NOT NULL DEFAULT 0,
  rot_x        REAL NOT NULL DEFAULT 0,
  rot_y        REAL NOT NULL DEFAULT 0,
  rot_z        REAL NOT NULL DEFAULT 0,
  scale_x      REAL NOT NULL DEFAULT 1,
  scale_y      REAL NOT NULL DEFAULT 1,
  scale_z      REAL NOT NULL DEFAULT 1,

  is_locked    BOOLEAN      NOT NULL DEFAULT FALSE,
  metadata     JSONB        NOT NULL DEFAULT '{}',
    -- Extensible: model URLs, custom colours, physics flags, etc.

  sort_order   INTEGER      NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_objects_layout  ON objects (layout_id);
CREATE INDEX idx_objects_company ON objects (company_id);
CREATE INDEX idx_objects_room    ON objects (room_id);

-- ──────────────────────────────────
--  6. LAYOUT VERSIONS (audit trail)
-- ──────────────────────────────────

CREATE TABLE layout_versions (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  layout_id    UUID         NOT NULL REFERENCES workspace_layouts (id) ON DELETE CASCADE,
  company_id   UUID         NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  version      INTEGER      NOT NULL,
  snapshot     JSONB        NOT NULL,  -- full serialised rooms + objects
  created_by   UUID         REFERENCES users (id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  UNIQUE (layout_id, version)
);

CREATE INDEX idx_versions_layout ON layout_versions (layout_id);

-- ──────────────────────────────────
--  7. ROW-LEVEL SECURITY
-- ──────────────────────────────────

-- Enable RLS on tenant-scoped tables
ALTER TABLE workspace_layouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms             ENABLE ROW LEVEL SECURITY;
ALTER TABLE objects           ENABLE ROW LEVEL SECURITY;
ALTER TABLE layout_versions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE users             ENABLE ROW LEVEL SECURITY;

-- Policies assume the application sets `app.current_company_id`
-- via SET LOCAL at the start of each transaction.

CREATE POLICY tenant_isolation_layouts ON workspace_layouts
  USING (company_id = current_setting('app.current_company_id')::UUID);

CREATE POLICY tenant_isolation_rooms ON rooms
  USING (company_id = current_setting('app.current_company_id')::UUID);

CREATE POLICY tenant_isolation_objects ON objects
  USING (company_id = current_setting('app.current_company_id')::UUID);

CREATE POLICY tenant_isolation_versions ON layout_versions
  USING (company_id = current_setting('app.current_company_id')::UUID);

CREATE POLICY tenant_isolation_users ON users
  USING (company_id = current_setting('app.current_company_id')::UUID);

-- ──────────────────────────────────
--  8. UPDATED_AT TRIGGER
-- ──────────────────────────────────

CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at_companies
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_users
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_layouts
  BEFORE UPDATE ON workspace_layouts
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_rooms
  BEFORE UPDATE ON rooms
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_objects
  BEFORE UPDATE ON objects
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
