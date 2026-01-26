import { VerifyEmailForm } from "@/components/VerifyEmailForm"

/**
 * Server component for email verification page
 * The actual verification logic is handled in the client component
 * since Firebase email link authentication requires client-side SDK
 */
export const dynamic = 'force-dynamic'

export default function VerifyPage() {
  return <VerifyEmailForm />
}
