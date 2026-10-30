# SmartBus

SmartBus is a local intercity bus-booking application built with React, TypeScript, Vite, Express, Prisma 6, and PostgreSQL. It uses the existing project workspace and database schema. Payments are simulated; no payment provider or card details are used.

## Prerequisites

- Node.js 24 and npm 11 (or compatible supported releases)
- PostgreSQL 18 running locally on port 5432
- The existing `smartbus_dev` database and applied initial migration

Never replace `.env` or `apps/api/.env` with the example template. Both `.env` files are ignored by Git. `.env.example` contains placeholders only.

## Local configuration

Prisma and the API load environment from the API workspace. Set `DATABASE_URL`, `JWT_SECRET`, and `PORT` in the existing `apps/api/.env` file. Use a private random `JWT_SECRET` of at least 32 bytes. The root `.env` is read by Vite for `VITE_API_URL`; the frontend defaults to `http://localhost:4000`.

For a new local PostgreSQL role/database, open the PostgreSQL 18 SQL Shell or run `psql -U postgres -h localhost -p 5432`, then use:

```sql
CREATE ROLE smartbus_app LOGIN;
```

At the psql prompt, set its password without placing it in command history:

```text
\password smartbus_app
```

Then create the dedicated development database:

```sql
CREATE DATABASE smartbus_dev OWNER smartbus_app;
```

If these objects already exist, keep using them; do not drop or recreate them. Put the role name and URL-encoded password into `DATABASE_URL` in `apps/api/.env`:

```text
DATABASE_URL="postgresql://smartbus_app:<url-encoded-password>@localhost:5432/smartbus_dev?schema=public"
```

The angle-bracket value is a placeholder, not a credential. URL-encode reserved characters in the password. Do not paste real environment values into chat or commit them.

## Install, database checks, and run

Run these commands in PowerShell from `C:\Naman\SEM 5\AWS\SmartBus`:

```powershell
npm.cmd install
npm.cmd run db:generate
npm.cmd run db:validate
npm.cmd run db:status
npm.cmd run db:seed
npm.cmd run dev
```

The initial migration is already applied in the configured development database. `db:status` is read-only. Do not run `db:migrate` unless you are intentionally reviewing and applying a new migration. The seed is repeatable and insert-only: it adds reserved demo cities, routes, a bus, seats, next-day trips, inventory, and fare rules using `skipDuplicates`; it never resets the database or reopens seats.

Open the Vite URL shown in the terminal (normally `http://127.0.0.1:5173`). The seeded route `SmartBus Demo Delhi → SmartBus Demo Jaipur` is available for the next India-local calendar day.

## Customer demonstration

1. Search the demo Delhi-to-Jaipur route and select a journey date.
2. Register with an email, username, name, and password (minimum 10 characters), or sign in.
3. Choose seats. The map shows premium seating and the server-calculated fares.
4. Hold seats for eight minutes. You can release them early; abandoned holds expire and become available again.
5. Choose either simulated success or simulated failure. No real payment is processed. Successful bookings appear under **My bookings**; failed attempts release inventory.
6. Cancel a confirmed booking at least two hours before departure to record the simulated refund and release its seats.
7. Completed journeys add route distance to loyalty. At 10,000 km, apply the one-time free-seat reward during checkout.
8. Use **Rewards** and the theme toggle from the navigation bar.

## Admin setup and demonstration

New registrations are always customers. To grant administrator access to a trusted account, connect as a PostgreSQL administrator and run an exact-email update:

```sql
UPDATE "User" SET "role" = 'ADMIN' WHERE lower("email") = lower('your-account@example.com');
```

Sign out and back in so the new role is reflected in the session. Admin screens and API routes are protected by the server, which rechecks the user's current database role. The dashboard supports city, route, bus and seat, trip, pricing-rule, and booking management. Records referenced by trips or bookings are protected by foreign-key and history checks.

The admin can mark a confirmed trip complete only after its scheduled arrival. This records one completed journey and updates the user's loyalty distance. To try the milestone quickly in a disposable local dataset, schedule a test route with 10,000 km distance; do not edit production/customer records.

## Tests and production build

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run db:validate
npm.cmd run db:status
```

The test suite includes mocked API search tests and a PostgreSQL-backed flow that creates randomly named fixtures, tests concurrent seat holds, payment outcomes, cancellations, reward redemption, and role checks, then removes only its own fixture rows. The integration suite requires a reachable `DATABASE_URL`. Its cleanup is scoped to the generated `e2e-*` identifiers and foreign-key dependencies; it does not reset or truncate the database.

## Safety and concurrency notes

- Passwords use bcrypt hashes; sessions use short-lived signed JWTs in HTTP-only cookies.
- Prices are computed server-side and stored as integer paise.
- Seat reservations lock inventory rows in serializable PostgreSQL transactions. The database also enforces one inventory row per `(tripId, seatId)`.
- Payment and refund records are simulated, idempotent, and auditable.
- Cancellation releases only inventory linked to that booking's `BookingSeat` rows.
- Search availability is a snapshot; booking rechecks inventory while holding database locks.