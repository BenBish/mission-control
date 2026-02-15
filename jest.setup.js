/**
 * Jest Setup File
 * Configures test environment before running tests
 */

// Mock uuid for ESM compatibility
jest.mock('uuid', () => ({
  v7: () => `test-uuid-${Math.random().toString(36).substr(2, 9)}`,
  v4: () => `test-uuid-${Math.random().toString(36).substr(2, 9)}`,
}), { virtual: true });
