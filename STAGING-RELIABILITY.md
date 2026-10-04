# Staging reliability

The RosterLlama staging app is pinned in Railway to a commit that passed PostgreSQL integration, browser, and reliability tests. Do not remove the pin or deploy a new commit until its CI checks pass. Promote each tested commit by connecting the staging service with commitSha; main pushes alone do not deploy.

The app starts with node server.js, uses /ready for deployment admission, retries transient database initialization failures, drains requests on SIGTERM, and closes database connections cleanly. /health additionally checks data integrity. GitHub's RosterLlama uptime workflow checks the public site, readiness, database and data integrity on a ten-minute schedule with retries. Scheduled runs can be delayed by GitHub.

PostgresPersistent is the authoritative database. Its /var/lib/postgresql/data volume contains PGDATA in pgdata, a pre-migration custom-format dump and verified source/destination row counts. The original Postgres service is retained read-only as the migration fallback; never redeploy, replace, or delete it before confirming the persistent database and backup are usable. Do not point the app back to the old database without reconciling any writes made after cutover.

The initial migration script refuses to overwrite an initialized destination, freezes source writes, restores transactionally, compares every public table's row count, and automatically unfreezes the source if the migration fails. A completed migration marker makes future database starts use the existing persistent data. SOURCE_DATABASE_URL is cleared after the verified migration. Database secrets remain Railway variables.

The health and staff operations feature work is preserved on health-staff-operations-wip. Family screens and feature-specific tests still need completion before promotion. Sales and AU production are separate services and are outside these changes.
