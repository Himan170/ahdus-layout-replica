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