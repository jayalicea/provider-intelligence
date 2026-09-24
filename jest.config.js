module.exports = {
  testEnvironment: 'node',
  // The stale nested checkout at ./provider-intelligence (a parallel git
  // worktree from an earlier session) must not contribute test suites.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/provider-intelligence/', '<rootDir>/client/']
};
