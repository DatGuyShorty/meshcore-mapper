module.exports = {
  testDir: './tests/smoke',
  // Coverage compute + terrain fetch can take well over the Playwright default;
  // inner expect() calls already use 120s for those, so the test-level timeout
  // must be at least as large or those tests fail before their own expectations
  // can fire.
  timeout: 180000,
  expect: {
    timeout: 15000,
  },
  reporter: 'list',
  use: {
    trace: 'retain-on-failure',
  },
};
