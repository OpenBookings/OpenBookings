import { NextRequest, NextResponse } from "next/server"
import { adminAuth } from "@/lib/firebase/firebaseAdmin"

/**
 * POST /api/auth/bootstrap-user
 * 
 * Verifies the Firebase ID token and optionally creates/updates user record
 * This is called after successful email link authentication
 * 
 * Headers: Authorization: Bearer <idToken>
 * Response: { success: true, userId: string } or error
 */
export async function POST(request: NextRequest) {
  try {
    // Get the Authorization header
    const authHeader = request.headers.get("Authorization")
    
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Missing or invalid Authorization header" },
        { status: 401 }
      )
    }

    // Extract the ID token
    const idToken = authHeader.substring(7) // Remove "Bearer " prefix

    // Verify the ID token
    let decodedToken
    try {
      decodedToken = await adminAuth.verifyIdToken(idToken)
    } catch (error: any) {
      console.error("Token verification error:", error)
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 }
      )
    }

    // Token is valid - user is authenticated
    // You can optionally create/update a user document in Firestore here
    // For now, we'll just return success since there's no existing Firestore structure
    
    // Example Firestore usage (commented out - uncomment if you want to use Firestore):
    // const db = admin.firestore()
    // const userRef = db.collection("users").doc(decodedToken.uid)
    // await userRef.set({
    //   email: decodedToken.email,
    //   emailVerified: decodedToken.email_verified,
    //   createdAt: admin.firestore.FieldValue.serverTimestamp(),
    //   lastLoginAt: admin.firestore.FieldValue.serverTimestamp(),
    // }, { merge: true })

    return NextResponse.json({
      success: true,
      userId: decodedToken.uid,
      email: decodedToken.email,
    })
  } catch (error) {
    console.error("Bootstrap user error:", error)
    return NextResponse.json(
      { error: "An error occurred while bootstrapping user" },
      { status: 500 }
    )
  }
}
