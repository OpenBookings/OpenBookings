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

export async function createMagicLink(email: string): Promise<string> {
  // Get base URL and ensure it's properly formatted
  let baseUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://openbookings.co"
  // Remove trailing slash
  baseUrl = baseUrl.replace(/\/$/, "")
  
  // Construct the action URL where Firebase will redirect after email verification
  const actionUrl = `${baseUrl}/auth/verify`
  console.log("Action URL:", actionUrl)

  const link = await adminAuth.generateSignInWithEmailLink(email, {
    url: actionUrl,
    handleCodeInApp: true,
  })
  
  // Fix: Firebase may use an incorrect base domain from authorized domains config
  // Replace any incorrect base domain with the correct one from our environment
  const correctBaseUrl = new URL(baseUrl)
  const linkUrl = new URL(link)
  
  // If the hostname doesn't match our expected domain, fix it
  if (linkUrl.hostname !== correctBaseUrl.hostname) {
    linkUrl.hostname = correctBaseUrl.hostname
    const fixedLink = linkUrl.toString()
    console.log("Fixed link:", fixedLink)
    return fixedLink
  }
  
  console.log("Generated link:", link)
  return link
}
