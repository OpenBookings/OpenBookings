import admin from "firebase-admin"

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  // Support both service account JSON and individual env vars
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    })
  } else if (process.env.FIREBASE_PROJECT_ID) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
    })
  } else {
    // For environments like Cloud Run where Application Default Credentials are used
    admin.initializeApp()
  }
}

export const adminAuth = admin.auth()
export const adminFirestore = admin.firestore()

/**
 * Creates a Firebase magic link for passwordless authentication
 * @param email - User's email address
 * @param redirectUrl - URL to redirect to after verification (defaults to /auth/verify)
 * @returns The magic link URL
 */
export async function createMagicLink(
  email: string,
  redirectUrl?: string
): Promise<string> {

  const url = `${process.env.NEXT_PUBLIC_APP_URL}/auth/verify`
  console.log(url)

  const link = await adminAuth.generateSignInWithEmailLink(email, {
    url,
    handleCodeInApp: true,
  })

  return link
}
