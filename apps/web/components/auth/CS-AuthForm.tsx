"use client";

import { useEffect, useState } from "react";
import posthog from "posthog-js";
import FocusOverlay from "@/components/plug-in/FocusOverlay";
import { SS_AuthForm } from "./SS-AuthForm";
import { AuthFormFields, AuthFormPhaseProvider } from "./AuthFormFields";
import { Kbd } from "@/components/ui/kbd";

const NOT_LINKED_MESSAGE =
    "An account already exists for this email. Sign in with the method you used originally — or, if this email belongs to your host account, use a different address.";

export function CS_AuthForm() {
    const [openCSAuthForm, setOpenCSAuthForm] = useState(false);
    const [initialError, setInitialError] = useState<string | null>(null);

    // OAuth failures come back as a full-page redirect to /?error=...; reopen
    // the sign-in overlay with the message and strip the param from the URL.
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get("error") !== "account_not_linked") return;
        setInitialError(NOT_LINKED_MESSAGE);
        setOpenCSAuthForm(true);
        params.delete("error");
        const query = params.toString();
        window.history.replaceState(
            null,
            "",
            window.location.pathname + (query ? `?${query}` : ""),
        );
    }, []);

    return (
        <>
            <button
                type="button"
                onClick={() => {
                    setOpenCSAuthForm(true);
                    posthog.capture("auth_form_opened");
                }}
                className="aspect-3/1 min-w-30 max-w-xs w-full bg-black/30 backdrop-blur-2xl rounded-lg sm:rounded-xl border border-white/20 shadow-2xl px-6 py-2 flex items-center justify-center"
                style={{
                    // Ensures button keeps aspect ratio even with dynamic widths
                    height: "auto",
                }}
            >
                <span className="text-base sm:text-lg font-normal whitespace-nowrap text-white">Get Started</span>
            </button>
            <FocusOverlay
                open={openCSAuthForm}
                onClose={() => setOpenCSAuthForm(false)}
            >
                <AuthFormPhaseProvider>
                    <SS_AuthForm
                        cardAction={
                            <div className="flex items-center gap-2">
                                <Kbd className="text-white/70 border-white/30 bg-white/10">Esc</Kbd>
                            </div>
                        }
                    >
                        <AuthFormFields
                            onSignInSuccess={() => setOpenCSAuthForm(false)}
                            initialError={initialError}
                        />
                    </SS_AuthForm>
                </AuthFormPhaseProvider>
            </FocusOverlay>
        </>
    );
}
