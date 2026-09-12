-- Dr Nadine Said, one-off after her move onto the shared codebase (2026-09-12).
-- Her vocabulary into the shared code's: category renames, and the one
-- permission the catalogue has over her database, granted as a fresh database
-- would grant it. Deliberately NOT seed:rbac, which would re-grant everything
-- her Admin removed.
--
-- Vaccines (5 items) is NOT in INVENTORY_CATEGORIES. Either add "Vaccines" to
-- that list in src/constants/inventory.ts (harmless for Mimo) or uncomment the
-- third UPDATE below to fold them into Medication. Decide before running.
-- Guarded: refuses unless settings.clinic.id = 'nadine' and 59 migrations
-- are applied. Run with psql on her DIRECT_URL (5432).
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE v text; n int;
BEGIN
  SELECT value INTO v FROM settings WHERE key = 'clinic.id';
  IF v IS DISTINCT FROM 'nadine' THEN
    RAISE EXCEPTION 'refusing: settings.clinic.id is %, expected nadine', coalesce(v, '<missing>');
  END IF;
  SELECT count(*) INTO n FROM _prisma_migrations WHERE finished_at IS NOT NULL;
  IF n < 59 THEN
    RAISE EXCEPTION 'only % migrations applied; run pnpm db:deploy to the end first', n;
  END IF;
END $$;

UPDATE public.inventory_items SET category = 'Food'       WHERE category = 'Food & Nutrition';
UPDATE public.inventory_items SET category = 'Medication' WHERE category = 'Drugs & Medications';
-- UPDATE public.inventory_items SET category = 'Medication' WHERE category = 'Vaccines';

INSERT INTO public.permissions (name, description)
VALUES ('messages:read', 'View website contact form messages')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
  FROM public.roles r, public.permissions p
 WHERE p.name = 'messages:read'
   AND r.name IN ('Admin', 'Vet', 'Receptionist', 'Groomer')
ON CONFLICT DO NOTHING;

COMMIT;
SELECT category, count(*) FROM public.inventory_items WHERE deleted_at IS NULL GROUP BY 1 ORDER BY 2 DESC;
SELECT r.name AS role, count(rp.*) AS grants
  FROM public.roles r LEFT JOIN public.role_permissions rp ON rp.role_id = r.role_id
 GROUP BY r.name ORDER BY r.name;
