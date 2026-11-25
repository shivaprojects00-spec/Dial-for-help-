# Dial for Help API

Node.js + Express API backed by PostgreSQL.

## Run locally

1. Use Node.js 20 or newer.
2. Copy `.env.example` to `.env` and fill in local values.
3. Create a PostgreSQL database and set `DATABASE_URL`.
4. From this directory run `npm install`, then `npm start`.

The API creates its tables from `schema.sql` at startup. Keep real credentials in Render environment settings or an untracked local `.env` file. Never commit secrets.

## Render

The API is deployed as a separate Node web service. Set these variables in the Render service's Environment page:

- `DATABASE_URL`: the database's **internal** connection URL when both resources are in the same Render region.
- `DATABASE_SSL`: `false` for Render's internal connection.
- `JWT_SECRET`: a private random value of at least 32 characters.
- `FRONTEND_ORIGINS`: comma-separated exact website origins.
- Optional admin bootstrap: `ADMIN_NAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` (at least 12 characters). There is no public admin registration endpoint.

Do not paste connection URLs, passwords, or JWT secrets into GitHub or public messages.

## Endpoints

- `GET /health` — service and database readiness
- `GET /api/v1` — API information
- `POST /api/v1/auth/register` — customer or partner registration
- `POST /api/v1/auth/login` — sign in
- `GET /api/v1/auth/me` — current account (Bearer token)
- `POST /api/v1/requests` — customer creates a service, hotel, or food request
- `GET /api/v1/requests/mine` — customer's requests
- `GET /api/v1/provider/requests` — partner request queue
- `POST /api/v1/provider/requests/:publicId/accept` — partner accepts an available request
- `PATCH /api/v1/provider/requests/:publicId/status` — partner updates an assigned request
- `GET /api/v1/admin/users` — admin-only user list
- `GET /api/v1/admin/requests` — admin-only request list

Registration roles are `customer`, `service_provider`, `hotel_partner`, and `food_partner`. Admin accounts are created only through private server environment configuration.

## Important launch notes

This is an initial backend foundation. Before handling real customers, add verified email/phone workflows, privacy/consent pages, partner verification and moderation, operational monitoring, backups, and a paid production database/service plan. The Free Render database is for testing only and expires after 30 days.
