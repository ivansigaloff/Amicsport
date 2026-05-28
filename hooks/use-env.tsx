import React, { createContext, useContext } from 'react';

type Environment = 'prod' | 'dev';

interface EnvironmentContextType {
  env: Environment;
  isDev: boolean;
  fromTable: (tableName: string) => string;
}

// Single-environment build: the separate `dev` environment was removed.
// This context is kept for API stability so existing callers that read
// `env` / `isDev` / `fromTable` keep working without changes.
const value: EnvironmentContextType = {
  env: 'prod',
  isDev: false,
  fromTable: (tableName: string) => tableName,
};

const EnvironmentContext = createContext<EnvironmentContextType>(value);

export function EnvironmentProvider({ children }: { children: React.ReactNode }) {
  return (
    <EnvironmentContext.Provider value={value}>
      {children}
    </EnvironmentContext.Provider>
  );
}

export function useEnv() {
  return useContext(EnvironmentContext);
}
