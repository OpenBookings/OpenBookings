"use client";

import { useState } from "react";
import posthog from "posthog-js";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { authClient } from "@/lib/auth-client";

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

    const setAndAutoClearMessage = (msg: { type: "success" | "error"; text: string }) => {
        setMessage(msg);
        setTimeout(() => setMessage(null), 3000);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setMessage(null);

        try {
            posthog.capture("magic_link_requested");

            const response = await fetch("/api/auth/login-link", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
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

            setAndAutoClearMessage({ type: "success", text: "Magic on its way!" });
            setEmail("");
        } catch {
            setAndAutoClearMessage({ type: "error", text: "Hmmm... try again." });
        } finally {
            setLoading(false);
        }
    };

    const handleGoogleClick = async () => {
        setGoogleLoading(true);
        setMessage(null);
        posthog.capture("sign_in_google_clicked");
        try {
            await authClient.signIn.social({
                provider: "google",
                callbackURL: "/",
            });
            // Page will redirect — onSignInSuccess called after redirect via session
        } catch (err: unknown) {
            const code = err instanceof Error ? err.message : String(err);
            posthog.capture("sign_in_failed", { provider: "google", error_code: code });
            setMessage({ type: "error", text: "Sign-in failed. Please try again." });
            setTimeout(() => setMessage(null), 5000);
            setGoogleLoading(false);
        }
    };

    const handleAppleClick = async () => {
        setAppleLoading(true);
        setMessage(null);
        posthog.capture("sign_in_apple_clicked");
        try {
            await authClient.signIn.social({
                provider: "apple",
                callbackURL: "/",
            });
            // Page will redirect — onSignInSuccess called after redirect via session
        } catch (err: unknown) {
            const code = err instanceof Error ? err.message : String(err);
            posthog.capture("sign_in_failed", { provider: "apple", error_code: code });
            setMessage({ type: "error", text: "Sign-in failed. Please try again." });
            setTimeout(() => setMessage(null), 5000);
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
