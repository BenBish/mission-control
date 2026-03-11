/**
 * Playwright globalTeardown.
 *
 * We intentionally do NOT clean up the test database here because
 * Playwright may invoke globalTeardown between globalSetup and the
 * webServer start (as a "teardown [as setup]" task). Deleting the DB
 * at that point would erase the seeded data before the API can read it.
 *
 * The seedDatabase() function in global-setup already removes stale DB
 * files before creating a fresh one, so cleanup is handled there.
 */

export default async function globalTeardown() {
  // no-op: cleanup is handled by seedDatabase() at the start of each run
}
