"use client";

import { useState } from "react";
import FocusOverlay from "@/components/FocusOverlay";
import { SS_AuthForm } from "./SS-AuthForm";
import { AuthFormFields } from "./AuthFormFields";
import { Kbd } from "@/components/ui/kbd";

export function CS_AuthForm() {
    const [openCSAuthForm, setOpenCSAuthForm] = useState(false);

    return (
        <>
            <button
                type="button"
                onClick={() => setOpenCSAuthForm(true)}
                className="aspect-3/1 min-w-30 max-w-xs w-full bg-black/30 backdrop-blur-2xl rounded-lg sm:rounded-xl border border-white/20 shadow-2xl px-6 py-2 flex items-center justify-center"
                style={{
                    // Ensures button keeps aspect ratio even with dynamic widths
                    height: "auto",
                }}
            >
                <span className="text-base sm:text-lg font-normal whitespace-nowrap">Get Started</span>
            </button>
            <FocusOverlay
                open={openCSAuthForm}
                onClose={() => setOpenCSAuthForm(false)}
            >
                <SS_AuthForm
                    cardAction={
                        <div className="flex items-center gap-2">
                            <Kbd className="text-white/70 border-white/30 bg-white/10">Esc</Kbd>
                        </div>
                    }
                >
                    <AuthFormFields onSignInSuccess={() => setOpenCSAuthForm(false)} />
                </SS_AuthForm>
            </FocusOverlay>
        </>
    );
}
