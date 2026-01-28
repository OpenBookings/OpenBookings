"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { auth } from "@/lib/firebase/firebase";
import { signInWithPopup, GoogleAuthProvider, OAuthProvider } from "firebase/auth";

function getProviderErrorMessage(
    code: string,
    provider: "google" | "apple"
): string {
    const providerName = provider === "google" ? "Google" : "Apple";
    switch (code) {
        case "auth/popup-closed-by-user":
            return "Sign-in was cancelled.";
        case "auth/account-exists-with-different-credential":
            return "An account already exists with this email. Try signing in with email link.";
        case "auth/popup-blocked":
            return "Popup was blocked. Please allow popups and try again.";
        case "auth/cancelled-popup-request":
            return "Sign-in was cancelled.";
        case "auth/internal-error":
            return `Enable ${providerName} under Firebase → Authentication → Sign-in method, and add this site in Authorized domains.`;
        case "auth/unauthorized-domain":
            return "Add this site in Firebase → Authentication → Settings → Authorized domains.";
        case "auth/operation-not-allowed":
            return `Turn on ${providerName} in Firebase → Authentication → Sign-in method.`;
        default:
            return "Sign-in failed. Please try again.";
    }
}

export function AuthFormFields({
    onSignInSuccess,
}: {
    onSignInSuccess?: () => void;
}) {
    const [email, setEmail] = useState("");
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<{
        type: "success" | "error";
        text: string;
    } | null>(null);
    const [googleLoading, setGoogleLoading] = useState(false);
    const [appleLoading, setAppleLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setMessage(null);

        const setAndAutoClearMessage = (msg: {
            type: "success" | "error";
            text: string;
        }) => {
            setMessage(msg);
            setTimeout(() => {
                setMessage(null);
            }, 3000);
        };

        try {
            const response = await fetch("/auth/login-link", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ email }),
            });

            const data = await response.json();

            if (!response.ok) {
                setAndAutoClearMessage({
                    type: "error",
                    text: data.error || "Hmmm... try again.",
                });
                return;
            }

            if (typeof window !== "undefined") {
                window.localStorage.setItem("emailForSignIn", email);
            }

            setAndAutoClearMessage({
                type: "success",
                text: "Magic on its way!",
            });
            setEmail("");
        } catch {
            setAndAutoClearMessage({
                type: "error",
                text: "Hmmm... try again.",
            });
        } finally {
            setLoading(false);
        }
    };

    const handleGoogleClick = async () => {
        setGoogleLoading(true);
        setMessage(null);
        try {
            const provider = new GoogleAuthProvider();
            const userCredential = await signInWithPopup(auth, provider);
            const idToken = await userCredential.user.getIdToken();
            const response = await fetch("/api/auth/bootstrap-user", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${idToken}`,
                },
            });
            if (!response.ok) {
                const body = await response.text();
            }
            onSignInSuccess?.();
        } catch (err: unknown) {
            const errObj = err != null && typeof err === "object" ? (err as Record<string, unknown>) : {};
            const code = typeof errObj.code === "string" ? errObj.code : undefined;
            const message = typeof errObj.message === "string" ? errObj.message : (err instanceof Error ? err.message : undefined);
            const name = typeof errObj.name === "string" ? errObj.name : (err instanceof Error ? err.name : undefined);
            const customData = errObj.customData;
            console.error("[AuthFormFields] Google sign-in: error", {
                code,
                message,
                name,
                customData,
                keys: Object.keys(errObj),
            });
            setMessage({
                type: "error",
                text: typeof code === "string" ? getProviderErrorMessage(code, "google") : "Sign-in failed. Please try again.",
            });
            setTimeout(() => setMessage(null), 5000);
        } finally {
            setGoogleLoading(false);
        }
    };

    const handleAppleClick = async () => {
        setAppleLoading(true);
        setMessage(null);
        try {
            const provider = new OAuthProvider("apple.com");
            provider.addScope("email");
            provider.addScope("name");
            const userCredential = await signInWithPopup(auth, provider);
            const idToken = await userCredential.user.getIdToken();
            const response = await fetch("/api/auth/bootstrap-user", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${idToken}`,
                },
            });
            if (!response.ok) {
                const body = await response.text();
            }
            onSignInSuccess?.();
        } catch (err: unknown) {
            const errObj = err != null && typeof err === "object" ? (err as Record<string, unknown>) : {};
            const code = typeof errObj.code === "string" ? errObj.code : undefined;
            console.error("[AuthFormFields] Apple sign-in: error", {
                code,
                keys: Object.keys(errObj),
            });
            setMessage({
                type: "error",
                text: typeof code === "string" ? getProviderErrorMessage(code, "apple") : "Sign-in failed. Please try again.",
            });
            setTimeout(() => setMessage(null), 5000);
        } finally {
            setAppleLoading(false);
        }
    };

    return (
        <>

            <form className="w-full" onSubmit={handleSubmit}>
                <div className="flex flex-col gap-3 w-full items-center">
                    <div className="grid gap-2 w-full">
                        <Input
                            id="email"
                            type="email"
                            placeholder="you@domain.com"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                        />
                    </div>
                    <Button
                        type="submit"
                        disabled={loading}
                        className="w-full px-4 py-3 sm:px-6 sm:py-4 text-gray-900 transition-all shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] text-sm sm:text-base bg-white/95 hover:bg-white"
                    >
                        {loading ? "Sending..." : "Send Magic Link"}
                    </Button>
                    {message && (
                        <p
                            role="alert"
                            className={[
                                "w-[50%] text-center text-sm px-2 py-1.5 rounded-md",
                                message.type === "error"
                                    ? "bg-red-500/20 text-red-100"
                                    : "bg-green-500 text-green-100",
                            ].join(" ")}
                        >
                            {message.text}
                        </p>
                    )}
                </div>
            </form>

            <div className="flex items-center w-full gap-2 justify-center">
                <Separator className="flex-1 mx-0 bg-white/40" />
                <span className="text-white/80 text-sm font-medium">or</span>
                <Separator className="flex-1 mx-0 bg-white/40" />
            </div>
            <div className="flex flex-row w-full gap-3">
                <Button
                    type="button"
                    variant="outline"
                    className="flex-1 flex items-center justify-center p-2 h-12 min-w-13"
                    style={{ minWidth: "3.25rem" }}
                    aria-label="Sign in with Apple"
                    disabled={appleLoading}
                    onClick={handleAppleClick}
                >
                    <img
                        src="/apple_logo.svg"
                        alt="Apple"
                        className="w-6 h-6"
                        style={{
                            filter: "invert(1) grayscale(1) brightness(2)",
                        }}
                        draggable="false"
                    />
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    className="flex-1 flex items-center justify-center p-2 h-12 min-w-13"
                    style={{ minWidth: "3.25rem" }}
                    aria-label="Sign in with Google"
                    disabled={googleLoading}
                    onClick={handleGoogleClick}
                >
                    <img
                        src="/google_logo.svg"
                        alt="Google"
                        className="w-6 h-6"
                        draggable="false"
                    />
                </Button>
            </div>
        </>
    );
}
