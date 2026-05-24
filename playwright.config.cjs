module.exports = {
  testDir: './tests/smoke',
  timeout: 30000,
  reporter: 'list',
  use: {
    trace: 'retain-on-failure',
  },
};
