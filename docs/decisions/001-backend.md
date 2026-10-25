# Backend Decision

## Decision

The project will use Supabase as the shared backend for all teams.

Supabase will provide:

- PostgreSQL database
- Authentication
- Row-Level Security
- Tenant isolation
- Storage for uploaded assets
- Backend support for layouts, versions, and audit records

## Why Supabase

- It provides managed PostgreSQL.
- It supports authentication and database authorization together.
- Row-Level Security can enforce company-level tenant isolation.
- It reduces the amount of custom backend infrastructure to maintain.
- It supports future offline synchronization and asset storage requirements.
- It is suitable for the existing frontend architecture.

## Alternatives Considered

### Self-managed PostgreSQL

Rejected because it would require the team to build and maintain authentication, API services, authorization, deployment, backups, and storage infrastructure.

### Custom backend with PostgreSQL

Rejected because it would introduce additional API and infrastructure work that Supabase already provides.

### localStorage

Rejected as the primary backend because it is browser-local, not shared between users, not secure for tenant isolation, and unsuitable for collaboration or version history.

## Consequences

- All teams must use the same Supabase project and database schema.
- Authentication and company membership must be coordinated with the Login team.
- Frontend code must never trust a client-provided `company_id`.
- Row-Level Security policies must protect every tenant-owned table.
- Supabase environment variables must be configured locally and in CI.
- `localStorage` will remain only as an offline cache and fallback.

## Status of the browser-side Supabase code (25 Oct 2026)

`src/services/apiService.js` has a browser-side Supabase path (R2: compare-and-set on `revision`, realtime;
R4: `layout_versions`). It is a **PROTOTYPE** and stays OFF unless `VITE_LAYOUT_BACKEND=supabase` is set as well as
the URL and key (`.env.example`); without the flag the app makes no network calls for layouts.
Production saving goes through the platform API (`docs/AHDUS_3D_INTEGRATION_PLAN.md`), which takes the tenant
from the server session, never from a `company_id` sent by the browser.