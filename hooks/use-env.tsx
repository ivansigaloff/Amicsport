import React, { createContext, useContext, useMemo, useCallback } from 'react';
import { useSegments } from 'expo-router';
import Constants from 'expo-constants';

type Environment = 'prod' | 'dev';

interface EnvironmentContextType {
  env: Environment;
  isDev: boolean;
  fromTable: (tableName: string) => string;
}

const EnvironmentContext = createContext<EnvironmentContextType | undefined>(undefined);

export function EnvironmentProvider({ children }: { children: React.ReactNode }) {
  const segments = useSegments();
  
  const env: Environment = useMemo(() => {
    // Si la base URL es /test, forzamos desarrollo
    const isTestBuild = Constants.expoConfig?.experiments?.baseUrl === '/test';
    if (isTestBuild) return 'dev';

    // Si cualquier parte de la ruta contiene 'dev', estamos en desarrollo
    if ((segments as string[]).includes('dev')) return 'dev';
    return 'prod';
  }, [segments]);

  const isDev = env === 'dev';

  const fromTable = useCallback((tableName: string) => {
    if (isDev) {
      // Evitar doble sufijo si ya lo tiene
      if (tableName.endsWith('_dev')) return tableName;
      return `${tableName}_dev`;
    }
    return tableName;
  }, [isDev]);

  const value = {
    env,
    isDev,
    fromTable,
  };

  return (
    <EnvironmentContext.Provider value={value}>
      {children}
    </EnvironmentContext.Provider>
  );
}

export function useEnv() {
  const context = useContext(EnvironmentContext);
  if (context === undefined) {
    // Fallback seguro si se usa fuera del provider (por defecto prod)
    return {
      env: 'prod' as Environment,
      isDev: false,
      fromTable: (name: string) => name,
    };
  }
  return context;
}
