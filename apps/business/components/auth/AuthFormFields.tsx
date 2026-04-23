"use client";

import {
    createContext,
    useContext,
    useEffect,
    useMemo,
    useState,
} from "react";
import posthog from "posthog-js";
import { ArrowRight } from "lucide-react";
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
                Business Portal
            </h2>
        </>
    );
}

export function AuthFormFields({
    onSignInSuccess,
    initialError,
}: {
    onSignInSuccess?: () => void;
    initialError?: string | null;
}) {
    const [email, setEmail] = useState("");
    const [loading, setLoading] = useState(false);
    const [googleLoading, setGoogleLoading] = useState(false);
    const [microsoftLoading, setMicrosoftLoading] = useState(false);
    const [magicLinkError, setMagicLinkError] = useState<string | null>(null);
    const [sentEmail, setSentEmail] = useState<string | null>(null);
    const [socialState, setSocialState] = useState<{
        provider: "google" | "microsoft";
        failed: boolean;
    } | null>(null);

    const setCardPhase = useContext(AuthFormPhaseContext)?.setPhase;

    useEffect(() => {
        if (initialError) setMagicLinkError(initialError);
    }, [initialError]);

    useEffect(() => {
        if (!setCardPhase) return;
        if (sentEmail) setCardPhase("email_sent");
        else if (socialState) setCardPhase("social");
        else setCardPhase("idle");
    }, [sentEmail, socialState, setCardPhase]);

    const resetSocialState = () => {
        setSocialState(null);
        setGoogleLoading(false);
        setMicrosoftLoading(false);
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
        } catch (err: unknown) {
            const code = err instanceof Error ? err.message : String(err);
            posthog.capture("sign_in_failed", { provider: "google", error_code: code });
            setSocialState({ provider: "google", failed: true });
            setGoogleLoading(false);
        }
    };

    const handleMicrosoftClick = async () => {
        setMicrosoftLoading(true);
        setMagicLinkError(null);
        setSentEmail(null);
        posthog.capture("sign_in_microsoft_clicked");
        try {
            const redirectPromise = authClient.signIn.social({
                provider: "microsoft",
                callbackURL: "/",
            });
            setSocialState({ provider: "microsoft", failed: false });
            await redirectPromise;
        } catch (err: unknown) {
            const code = err instanceof Error ? err.message : String(err);
            posthog.capture("sign_in_failed", { provider: "microsoft", error_code: code });
            setSocialState({ provider: "microsoft", failed: true });
            setMicrosoftLoading(false);
        }
    };

    const providerLabel = socialState?.provider === "microsoft" ? "Microsoft" : "Google";

    if (sentEmail) {
        return (
            <div className="w-full min-h-[238px] flex flex-col justify-center items-center text-center gap-3">
                <h3 className="text-2xl font-semibold text-white">Email sent successfully</h3>
                <p className="text-white/85 max-w-xs">Please check your inbox at {sentEmail}</p>
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
                                    : handleMicrosoftClick
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
                <div className="flex flex-col gap-3 w-full">
                    <div className="flex gap-2 w-full">
                        <Input
                            id="email"
                            type="email"
                            placeholder="you@domain.com"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="flex-1 h-10"
                        />
                        <Button
                            type="submit"
                            disabled={loading}
                            size="icon"
                            className="h-10 w-10 shrink-0 bg-white/95 hover:bg-white text-gray-900 shadow-md hover:shadow-lg transition-all hover:scale-[1.04] active:scale-[0.97]"
                            aria-label="Send magic link"
                        >
                            <ArrowRight className="w-4 h-4" />
                        </Button>
                    </div>
              
                    {magicLinkError ? (
                        <p
                            role="alert"
                            className="w-full text-center text-sm px-2 py-1.5 rounded-md bg-red-500/20 text-red-100"
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

            <div className="flex flex-col w-full gap-3">
                <Button
                    type="button"
                    variant="outline"
                    className="w-full flex items-center justify-center gap-3 h-11"
                    disabled={googleLoading}
                    onClick={handleGoogleClick}
                >
                    <img
                        src="/google_logo.svg"
                        alt=""
                        className="w-5 h-5 shrink-0"
                        draggable="false"
                    />
                    <span>{googleLoading ? "Redirecting..." : "Sign in with Google"}</span>
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    className="w-full flex items-center justify-center gap-3 h-11"
                    disabled={microsoftLoading}
                    onClick={handleMicrosoftClick}
                >
                    <img
                        src="/microsoft_logo.png"
                        alt=""
                        className="w-5 h-5 shrink-0"
                        draggable="false"
                    />
                    <span>{microsoftLoading ? "Redirecting..." : "Sign in with Microsoft"}</span>
                </Button>
            </div>
        </>
    );
}
