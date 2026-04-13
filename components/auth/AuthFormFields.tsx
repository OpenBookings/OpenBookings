"use client";

import {
    createContext,
    useContext,
    useEffect,
    useMemo,
    useState,
} from "react";
import posthog from "posthog-js";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { authClient } from "@/lib/auth-client";

export type AuthFormCardPhase = "idle" | "email_sent" | "social";

type AuthFormPhaseContextValue = {
    phase: AuthFormCardPhase;
    setPhase: (phase: AuthFormCardPhase) => void;
};

const AuthFormPhaseContext = createContext<AuthFormPhaseContextValue | null>(
    null,
);

export function AuthFormPhaseProvider({
    children,
}: {
    children: React.ReactNode;
}) {
    const [phase, setPhase] = useState<AuthFormCardPhase>("idle");
    const value = useMemo(() => ({ phase, setPhase }), [phase]);
    return (
        <AuthFormPhaseContext.Provider value={value}>
            {children}
        </AuthFormPhaseContext.Provider>
    );
}

/** Shown in the card header only while the main sign-in form is visible. */
export function AuthFormWelcomeTitle() {
    const ctx = useContext(AuthFormPhaseContext);
    if (ctx && ctx.phase !== "idle") return null;
    return (
        <>
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-2">
                Welcome
            </h2>
            <p className="text-white/90 font-medium">Sign in to OpenBookings</p>
        </>
    );
}

export function AuthFormFields({
    onSignInSuccess,
}: {
    onSignInSuccess?: () => void;
}) {
    const [email, setEmail] = useState("");
    const [loading, setLoading] = useState(false);
    const [googleLoading, setGoogleLoading] = useState(false);
    const [appleLoading, setAppleLoading] = useState(false);
    const [magicLinkError, setMagicLinkError] = useState<string | null>(null);
    const [sentEmail, setSentEmail] = useState<string | null>(null);
    const [socialState, setSocialState] = useState<{
        provider: "google" | "apple";
        failed: boolean;
    } | null>(null);

    const setCardPhase = useContext(AuthFormPhaseContext)?.setPhase;

    useEffect(() => {
        if (!setCardPhase) return;
        if (sentEmail) setCardPhase("email_sent");
        else if (socialState) setCardPhase("social");
        else setCardPhase("idle");
    }, [sentEmail, socialState, setCardPhase]);

    const resetSocialState = () => {
        setSocialState(null);
        setGoogleLoading(false);
        setAppleLoading(false);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setMagicLinkError(null);
        setSentEmail(null);
        resetSocialState();

        try {
            posthog.capture("magic_link_requested");

            const response = await fetch("/api/auth/login-link", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email }),
            });

            const data = await response.json();

            if (!response.ok) {
                setMagicLinkError(data.error || "Hmmm... try again.");
                return;
            }

            setSentEmail(email);
            setEmail("");
        } catch {
            setMagicLinkError("Hmmm... try again.");
        } finally {
            setLoading(false);
        }
    };

    const handleGoogleClick = async () => {
        setGoogleLoading(true);
        setMagicLinkError(null);
        setSentEmail(null);
        posthog.capture("sign_in_google_clicked");
        try {
            const redirectPromise = authClient.signIn.social({
                provider: "google",
                callbackURL: "/",
            });
            setSocialState({ provider: "google", failed: false });
            await redirectPromise;
            // Page will redirect — onSignInSuccess called after redirect via session
        } catch (err: unknown) {
            const code = err instanceof Error ? err.message : String(err);
            posthog.capture("sign_in_failed", { provider: "google", error_code: code });
            setSocialState({ provider: "google", failed: true });
            setGoogleLoading(false);
        }
    };

    const handleAppleClick = async () => {
        setAppleLoading(true);
        setMagicLinkError(null);
        setSentEmail(null);
        posthog.capture("sign_in_apple_clicked");
        try {
            const redirectPromise = authClient.signIn.social({
                provider: "apple",
                callbackURL: "/",
            });
            setSocialState({ provider: "apple", failed: false });
            await redirectPromise;
            // Page will redirect — onSignInSuccess called after redirect via session
        } catch (err: unknown) {
            const code = err instanceof Error ? err.message : String(err);
            posthog.capture("sign_in_failed", { provider: "apple", error_code: code });
            setSocialState({ provider: "apple", failed: true });
            setAppleLoading(false);
        }
    };

    const providerLabel = socialState?.provider === "apple" ? "Apple" : "Google";

    if (sentEmail) {
        return (
            <div className="w-full min-h-[238px] flex flex-col justify-center items-center text-center gap-3">
                <h3 className="text-2xl font-semibold text-white">Email sent successfully</h3>
                <p className="text-white/85 max-w-xs">
                    Please check your inbox{sentEmail ? ` at ${sentEmail}` : ""}.
                </p>
                <Button
                    type="button"
                    variant="outline"
                    className="mt-2"
                    onClick={() => setSentEmail(null)}
                >
                    Use another email
                </Button>
            </div>
        );
    }

    if (socialState) {
        return (
            <div className="w-full min-h-[238px] flex flex-col justify-center items-center text-center gap-3">
                <h3 className="text-2xl font-semibold text-white">
                    {socialState.failed ? `Failed to continue with ${providerLabel}` : `Redirecting you to ${providerLabel}`}
                </h3>
                <p className="text-white/85 max-w-xs">
                    {socialState.failed
                        ? "Failed? Try again."
                        : "Complete sign-in in the next window."}
                </p>
                {socialState.failed ? (
                    <div className="flex gap-2 mt-2">
                        <Button
                            type="button"
                            onClick={
                                socialState.provider === "google"
                                    ? handleGoogleClick
                                    : handleAppleClick
                            }
                        >
                            Try Again
                        </Button>
                        <Button type="button" variant="outline" onClick={resetSocialState}>
                            Back
                        </Button>
                    </div>
                ) : null}
            </div>
        );
    }

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
                    {magicLinkError ? (
                        <p
                            role="alert"
                            className="w-[50%] text-center text-sm px-2 py-1.5 rounded-md bg-red-500/20 text-red-100"
                        >
                            {magicLinkError}
                        </p>
                    ) : null}
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
                        style={{ filter: "invert(1) grayscale(1) brightness(2)" }}
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
