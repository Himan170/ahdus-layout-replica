-- Company Digital Twin — Supabase schema
--
-- R3 database foundation:
--   - tenant-scoped layout-v2 entities
--   - floors, anchors, routes, and stairs/elevator floor links
--   - revision column reserved for server-side compare-and-set saves
--   - Row-Level Security derived from Supabase Auth membership
--
-- Run this file against a fresh Supabase database.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ────────────────────────────────────────────────────────────────────────
-- Tenants and Auth user membership
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE companies (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  logo_url    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Profile row for a Supabase Auth user. A user can belong to multiple
-- companies through company_memberships.
CREATE TABLE users (
  id           UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  display_name TEXT,
  avatar_url   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE company_memberships (
  user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  company_id  UUID NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'editor'
              CHECK (role IN ('admin', 'editor', 'viewer')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, company_id)
);

CREATE INDEX idx_memberships_company
  ON company_memberships (company_id);

-- ────────────────────────────────────────────────────────────────────────
-- Layout and layout-v2 entities
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE workspace_layouts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  name        TEXT NOT NULL DEFAULT 'Untitled Layout',
  revision    INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  version     INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by  UUID REFERENCES users (id) ON DELETE SET NULL,
  updated_by  UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, id)
);

CREATE INDEX idx_layouts_company_updated
  ON workspace_layouts (company_id, updated_at DESC);

CREATE TABLE floors (
  id          TEXT NOT NULL,
  layout_id   UUID NOT NULL,
  company_id  UUID NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  name        TEXT NOT NULL DEFAULT 'Ground Floor',
  height      REAL NOT NULL DEFAULT 3.5 CHECK (height > 0),
  elevation   REAL,
  underlay    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (layout_id, id),
  FOREIGN KEY (company_id, layout_id)
    REFERENCES workspace_layouts (company_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_floors_company_layout
  ON floors (company_id, layout_id);

CREATE TABLE rooms (
  id              TEXT NOT NULL,
  layout_id       UUID NOT NULL,
  company_id      UUID NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  floor_id        TEXT NOT NULL,
  type            TEXT NOT NULL DEFAULT 'OFFICE',
  name            TEXT NOT NULL,
  x               REAL NOT NULL DEFAULT 0,
  z               REAL NOT NULL DEFAULT 0,
  width           REAL NOT NULL DEFAULT 6 CHECK (width > 0),
  depth           REAL NOT NULL DEFAULT 5 CHECK (depth > 0),
  wall_height     REAL NOT NULL DEFAULT 3 CHECK (wall_height > 0),
  color           TEXT NOT NULL DEFAULT '#4a7dff',
  floor_finish    TEXT NOT NULL DEFAULT 'default',
  department_ref  TEXT,
  openings        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (layout_id, id),
  FOREIGN KEY (company_id, layout_id)
    REFERENCES workspace_layouts (company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (layout_id, floor_id)
    REFERENCES floors (layout_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_rooms_company_layout
  ON rooms (company_id, layout_id);

CREATE TABLE objects (
  id          TEXT NOT NULL,
  layout_id   UUID NOT NULL,
  company_id  UUID NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  floor_id    TEXT NOT NULL,
  room_id     TEXT,
  asset_type  TEXT NOT NULL,
  label       TEXT NOT NULL DEFAULT '',
  department  TEXT NOT NULL DEFAULT '',
  pos_x       REAL NOT NULL DEFAULT 0,
  pos_y       REAL NOT NULL DEFAULT 0,
  pos_z       REAL NOT NULL DEFAULT 0,
  rot_x       REAL NOT NULL DEFAULT 0,
  rot_y       REAL NOT NULL DEFAULT 0,
  rot_z       REAL NOT NULL DEFAULT 0,
  scale_x     REAL NOT NULL DEFAULT 1 CHECK (scale_x > 0),
  scale_y     REAL NOT NULL DEFAULT 1 CHECK (scale_y > 0),
  scale_z     REAL NOT NULL DEFAULT 1 CHECK (scale_z > 0),
  is_locked   BOOLEAN NOT NULL DEFAULT false,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (layout_id, id),
  FOREIGN KEY (company_id, layout_id)
    REFERENCES workspace_layouts (company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (layout_id, floor_id)
    REFERENCES floors (layout_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (layout_id, room_id)
    REFERENCES rooms (layout_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_objects_company_layout
  ON objects (company_id, layout_id);

CREATE TABLE anchors (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  layout_id    UUID NOT NULL,
  company_id   UUID NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  floor_id     TEXT NOT NULL,
  room_id      TEXT,
  object_id    TEXT,
  kind         TEXT NOT NULL,
  position     JSONB NOT NULL,
  rotation_y   REAL NOT NULL DEFAULT 0,
  position_ref TEXT,
  label        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, layout_id)
    REFERENCES workspace_layouts (company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (layout_id, floor_id)
    REFERENCES floors (layout_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (layout_id, room_id)
    REFERENCES rooms (layout_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (layout_id, object_id)
    REFERENCES objects (layout_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_anchors_company_layout
  ON anchors (company_id, layout_id);

CREATE TABLE routes (
  id          TEXT NOT NULL,
  layout_id   UUID NOT NULL,
  company_id  UUID NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  floor_id    TEXT NOT NULL,
  kind        TEXT NOT NULL
              CHECK (kind IN ('evacuation', 'accessible', 'custom')),
  label       TEXT NOT NULL DEFAULT '',
  waypoints   JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (layout_id, id),
  FOREIGN KEY (company_id, layout_id)
    REFERENCES workspace_layouts (company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (layout_id, floor_id)
    REFERENCES floors (layout_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_routes_company_layout
  ON routes (company_id, layout_id);

CREATE TABLE floor_links (
  id             TEXT NOT NULL,
  layout_id      UUID NOT NULL,
  company_id     UUID NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('stairs', 'elevator')),
  from_object_id TEXT NOT NULL,
  to_object_id   TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (layout_id, id),
  FOREIGN KEY (company_id, layout_id)
    REFERENCES workspace_layouts (company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (layout_id, from_object_id)
    REFERENCES objects (layout_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (layout_id, to_object_id)
    REFERENCES objects (layout_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_floor_links_company_layout
  ON floor_links (company_id, layout_id);

-- ────────────────────────────────────────────────────────────────────────
-- Existing version-history foundation
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE layout_versions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  layout_id   UUID NOT NULL,
  company_id  UUID NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  version     INTEGER NOT NULL CHECK (version >= 1),
  revision    INTEGER NOT NULL CHECK (revision >= 1),
  snapshot    JSONB NOT NULL,
  created_by  UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (layout_id, version),
  FOREIGN KEY (company_id, layout_id)
    REFERENCES workspace_layouts (company_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_versions_company_layout
  ON layout_versions (company_id, layout_id, version DESC);

-- ────────────────────────────────────────────────────────────────────────
-- Object/room change log
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE layout_change_log (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  layout_id    UUID NOT NULL,
  entity_type  TEXT NOT NULL CHECK (
    entity_type IN ('floor', 'room', 'object', 'anchor', 'route', 'floor_link')
  ),
  entity_id    TEXT NOT NULL,
  action       TEXT NOT NULL CHECK (
    action IN ('created', 'updated', 'deleted', 'restored')
  ),
  before_data  JSONB,
  after_data   JSONB,
  changed_by   UUID REFERENCES users (id) ON DELETE SET NULL,
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, layout_id)
    REFERENCES workspace_layouts (company_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_change_log_company_layout_time
  ON layout_change_log (company_id, layout_id, changed_at DESC);

-- ────────────────────────────────────────────────────────────────────────
-- RLS: membership is the tenant authority
-- ────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.user_has_company_access(target_company UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.company_memberships membership
    WHERE membership.user_id = auth.uid()
      AND membership.company_id = target_company
  );
$$;

REVOKE ALL ON FUNCTION public.user_has_company_access(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_has_company_access(UUID) TO authenticated;

ALTER TABLE companies           ENABLE ROW LEVEL SECURITY;
ALTER TABLE users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_layouts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE floors              ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms               ENABLE ROW LEVEL SECURITY;
ALTER TABLE objects             ENABLE ROW LEVEL SECURITY;
ALTER TABLE anchors             ENABLE ROW LEVEL SECURITY;
ALTER TABLE routes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE floor_links         ENABLE ROW LEVEL SECURITY;
ALTER TABLE layout_versions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE layout_change_log   ENABLE ROW LEVEL SECURITY;

CREATE POLICY companies_member_select ON companies
  FOR SELECT TO authenticated
  USING (public.user_has_company_access(id));

CREATE POLICY users_self_select ON users
  FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY memberships_self_select ON company_memberships
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY layouts_member_access ON workspace_layouts
  FOR ALL TO authenticated
  USING (public.user_has_company_access(company_id))
  WITH CHECK (public.user_has_company_access(company_id));

CREATE POLICY floors_member_access ON floors
  FOR ALL TO authenticated
  USING (public.user_has_company_access(company_id))
  WITH CHECK (public.user_has_company_access(company_id));

CREATE POLICY rooms_member_access ON rooms
  FOR ALL TO authenticated
  USING (public.user_has_company_access(company_id))
  WITH CHECK (public.user_has_company_access(company_id));

CREATE POLICY objects_member_access ON objects
  FOR ALL TO authenticated
  USING (public.user_has_company_access(company_id))
  WITH CHECK (public.user_has_company_access(company_id));

CREATE POLICY anchors_member_access ON anchors
  FOR ALL TO authenticated
  USING (public.user_has_company_access(company_id))
  WITH CHECK (public.user_has_company_access(company_id));

CREATE POLICY routes_member_access ON routes
  FOR ALL TO authenticated
  USING (public.user_has_company_access(company_id))
  WITH CHECK (public.user_has_company_access(company_id));

CREATE POLICY floor_links_member_access ON floor_links
  FOR ALL TO authenticated
  USING (public.user_has_company_access(company_id))
  WITH CHECK (public.user_has_company_access(company_id));

CREATE POLICY versions_member_access ON layout_versions
  FOR ALL TO authenticated
  USING (public.user_has_company_access(company_id))
  WITH CHECK (public.user_has_company_access(company_id));

CREATE POLICY change_log_member_access ON layout_change_log
  FOR SELECT TO authenticated
  USING (public.user_has_company_access(company_id));

CREATE OR REPLACE FUNCTION public.record_layout_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row_data JSONB;
  old_data JSONB;
  row_company UUID;
  row_layout UUID;
  row_entity_id TEXT;
  row_action TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    row_data := NULL;
    old_data := to_jsonb(OLD);
    row_company := OLD.company_id;
    row_layout := OLD.layout_id;
    row_entity_id := OLD.id::TEXT;
    row_action := 'deleted';
  ELSE
    row_data := to_jsonb(NEW);
    old_data := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END;
    row_company := NEW.company_id;
    row_layout := NEW.layout_id;
    row_entity_id := NEW.id::TEXT;
    row_action := CASE WHEN TG_OP = 'INSERT' THEN 'created' ELSE 'updated' END;
  END IF;

  IF TG_OP = 'UPDATE' AND row_data = old_data THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.layout_change_log (
    company_id,
    layout_id,
    entity_type,
    entity_id,
    action,
    before_data,
    after_data,
    changed_by
  )
  VALUES (
    row_company,
    row_layout,
    CASE TG_TABLE_NAME
      WHEN 'floor_links' THEN 'floor_link'
      ELSE rtrim(TG_TABLE_NAME, 's')
    END,
    row_entity_id,
    row_action,
    old_data,
    row_data,
    auth.uid()
  );

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE ALL ON FUNCTION public.record_layout_change() FROM PUBLIC;

CREATE TRIGGER floors_record_layout_change
  AFTER INSERT OR UPDATE OR DELETE ON floors
  FOR EACH ROW EXECUTE FUNCTION public.record_layout_change();

CREATE TRIGGER rooms_record_layout_change
  AFTER INSERT OR UPDATE OR DELETE ON rooms
  FOR EACH ROW EXECUTE FUNCTION public.record_layout_change();

CREATE TRIGGER objects_record_layout_change
  AFTER INSERT OR UPDATE OR DELETE ON objects
  FOR EACH ROW EXECUTE FUNCTION public.record_layout_change();

CREATE TRIGGER anchors_record_layout_change
  AFTER INSERT OR UPDATE OR DELETE ON anchors
  FOR EACH ROW EXECUTE FUNCTION public.record_layout_change();

CREATE TRIGGER routes_record_layout_change
  AFTER INSERT OR UPDATE OR DELETE ON routes
  FOR EACH ROW EXECUTE FUNCTION public.record_layout_change();

CREATE TRIGGER floor_links_record_layout_change
  AFTER INSERT OR UPDATE OR DELETE ON floor_links
  FOR EACH ROW EXECUTE FUNCTION public.record_layout_change();

-- ────────────────────────────────────────────────────────────────────────
-- Common timestamp maintenance
-- ────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER companies_set_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER layouts_set_updated_at
  BEFORE UPDATE ON workspace_layouts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER floors_set_updated_at
  BEFORE UPDATE ON floors
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER rooms_set_updated_at
  BEFORE UPDATE ON rooms
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER objects_set_updated_at
  BEFORE UPDATE ON objects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER anchors_set_updated_at
  BEFORE UPDATE ON anchors
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER routes_set_updated_at
  BEFORE UPDATE ON routes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER floor_links_set_updated_at
  BEFORE UPDATE ON floor_links
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
