declare global {
  namespace NodeJS {
    interface ProcessEnv {
      NPM_REGISTRY?: string
    }
  }
}

export {}
