import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SS_AuthForm } from "@/components/auth/SS-AuthForm";
import { AuthFormFields, AuthFormPhaseProvider } from "@/components/auth/AuthFormFields";

export default async function LoginPage() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (session) {
    redirect("/");
  }

  return (
    <main className="min-h-screen bg-neutral-950 flex items-center justify-center p-4">
      <AuthFormPhaseProvider>
        <SS_AuthForm>
          <AuthFormFields />
        </SS_AuthForm>
      </AuthFormPhaseProvider>
    </main>
  );
}
