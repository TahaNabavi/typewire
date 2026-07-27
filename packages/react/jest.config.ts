import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  // Hooks need a DOM: react-dom renders into one, and useSyncExternalStore's
  // subscribe/teardown only runs under a real commit.
  testEnvironment: "jsdom",
  roots: ["<rootDir>/src"],
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  transform: {
    "^.+\\.(ts|tsx)$": ["ts-jest", { tsconfig: { jsx: "react-jsx" } }],
  },
  testMatch: ["**/*.test.ts", "**/*.test.tsx"],
  collectCoverage: true,
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.d.ts",
    "!src/__tests__/**",
  ],
  coverageDirectory: "coverage",
  clearMocks: true,
};

export default config;
