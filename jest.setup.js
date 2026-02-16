/**
 * Jest Setup File
 * Configures test environment before running tests
 */

const fs = require('fs');
const path = require('path');

// Mock uuid for ESM compatibility
jest.mock('uuid', () => ({
  v7: () => `test-uuid-${Math.random().toString(36).substr(2, 9)}`,
  v4: () => `test-uuid-${Math.random().toString(36).substr(2, 9)}`,
}), { virtual: true });

// Clean up test data before each test suite
beforeAll(() => {
  const testDataDir = './test-data';
  if (fs.existsSync(testDataDir)) {
    const files = fs.readdirSync(testDataDir);
    for (const file of files) {
      const filePath = path.join(testDataDir, file);
      if (fs.statSync(filePath).isFile()) {
        try {
          fs.unlinkSync(filePath);
        } catch (error) {
          // Ignore errors, file might be in use
        }
      }
    }
  }
});

// Increase default test timeout for database operations
jest.setTimeout(10000);
