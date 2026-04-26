const nextJest = require('next/jest')

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files
  dir: './',
})

// Add any custom config to be passed to Jest
const customJestConfig = {
  // Run before each test file's module graph loads. Seeds env vars that
  // source modules (e.g. src/lib/digitalocean.ts) capture at
  // module-load time, so jest.mock + import order doesn't have to fight
  // process.env timing.
  setupFiles: ['<rootDir>/jest.setup.env.js'],
  setupFilesAfterEnv: [],
  testEnvironment: 'jsdom',
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
  ],
  transformIgnorePatterns: [
    'node_modules/(?!(nanoid)/)',
  ],
  // sinon (transitive dep of aws-sdk-client-mock) ships an ESM entry via
  // package.json `module` field that next/jest picks up but cannot transform.
  // Force resolution to the CJS build for the test runtime.
  moduleNameMapper: {
    '^sinon$': '<rootDir>/node_modules/sinon/lib/sinon.js',
  },
}

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
module.exports = createJestConfig(customJestConfig)