// firebase.ts
import { initializeApp, getApps } from "firebase/app"
import { getAuth, Auth } from "firebase/auth"

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
}

// Lazy initialization to prevent build-time errors
// Firebase will only be initialized when actually accessed in the browser
let app: ReturnType<typeof initializeApp> | undefined
let authInstance: Auth | undefined

function initializeFirebase(): Auth {
  // Return existing instance if already initialized
  if (authInstance) {
    return authInstance
  }

  // Check if Firebase is already initialized
  const existingApps = getApps()
  if (existingApps.length > 0) {
    app = existingApps[0]
  } else {
    // Only initialize if we have the required config
    // During build time, this might fail, but the page is marked as dynamic
    // so it won't be statically generated
    if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
      // Provide a helpful error message
      const missingVars = []
      if (!firebaseConfig.apiKey) missingVars.push('NEXT_PUBLIC_FIREBASE_API_KEY')
      if (!firebaseConfig.projectId) missingVars.push('NEXT_PUBLIC_FIREBASE_PROJECT_ID')
      
      throw new Error(
        `Firebase configuration is missing. Please set the following environment variables: ${missingVars.join(', ')}`
      )
    }

    app = initializeApp(firebaseConfig)
  }

  authInstance = getAuth(app)
  return authInstance
}

// Export a getter that initializes Firebase lazily
// This ensures Firebase is only initialized when actually used (in the browser)
export const auth = new Proxy({} as Auth, {
  get(_target, prop) {
    const auth = initializeFirebase()
    const value = (auth as any)[prop]
    // Bind functions to maintain 'this' context
    if (typeof value === 'function') {
      return value.bind(auth)
    }
    return value
  }
})
