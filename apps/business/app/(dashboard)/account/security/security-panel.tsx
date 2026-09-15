"use client";

import { useCallback, useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type PasskeyRow = {
  id: string;
  name?: string | null;
  createdAt?: string | Date | null;
  backedUp?: boolean;
};

type SessionRow = {
  token: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt?: string | Date | null;
};

function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

/** Trim a user-agent down to something a hotel owner can recognise. */
function describeDevice(userAgent: string | null | undefined): string {
  if (!userAgent) return "Unknown device";
  const browser =
    userAgent.match(/(Edg|Firefox|Chrome|Safari)\/[\d.]+/)?.[1] ?? "Browser";
  const os = userAgent.match(/\(([^);]+)/)?.[1] ?? "";
  return [browser === "Edg" ? "Edge" : browser, os].filter(Boolean).join(" · ");
}

export function SecurityPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [passkeys, setPasskeys] = useState<PasskeyRow[]>([]);
  const [addingPasskey, setAddingPasskey] = useState(false);
  const [passkeyName, setPasskeyName] = useState("");

  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [totpPending, setTotpPending] = useState(false);

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [currentToken, setCurrentToken] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    const [passkeyResult, sessionsResult, current] = await Promise.all([
      authClient.passkey.listUserPasskeys(),
      authClient.listSessions(),
      authClient.getSession(),
    ]);
    if (passkeyResult.data) setPasskeys(passkeyResult.data as PasskeyRow[]);
    if (sessionsResult.data) setSessions(sessionsResult.data as SessionRow[]);
    if (current.data) {
      setCurrentToken(current.data.session.token);
      const user = current.data.user as { twoFactorEnabled?: boolean | null };
      setTwoFactorEnabled(!!user.twoFactorEnabled);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addPasskey = async () => {
    setAddingPasskey(true);
    setError(null);
    try {
      const result = await authClient.passkey.addPasskey({
        name: passkeyName.trim() || undefined,
      });
      if (result?.error) {
        setError(result.error.message ?? "Could not add the passkey.");
      } else {
        setPasskeyName("");
        await refresh();
      }
    } catch {
      setError("Passkey setup was cancelled or is not supported on this device.");
    } finally {
      setAddingPasskey(false);
    }
  };

  const deletePasskey = async (id: string) => {
    setError(null);
    const result = await authClient.passkey.deletePasskey({ id });
    if (result?.error) {
      setError(result.error.message ?? "Could not delete the passkey.");
    }
    await refresh();
  };

  const enableTwoFactor = async () => {
    setTotpPending(true);
    setError(null);
    const result = await authClient.twoFactor.enable({});
    if (result.error || !result.data) {
      setError(result.error?.message ?? "Could not start two-factor setup.");
    } else {
      setTotpUri(result.data.totpURI);
      setBackupCodes(result.data.backupCodes);
    }
    setTotpPending(false);
  };

  const confirmTotp = async () => {
    setTotpPending(true);
    setError(null);
    const result = await authClient.twoFactor.verifyTotp({ code: totpCode.trim() });
    if (result.error) {
      setError("That code didn't match. Check your authenticator app and try again.");
    } else {
      setTotpUri(null);
      setTotpCode("");
      setTwoFactorEnabled(true);
      await refresh();
    }
    setTotpPending(false);
  };

  const disableTwoFactor = async () => {
    setTotpPending(true);
    setError(null);
    const result = await authClient.twoFactor.disable({});
    if (result.error) {
      setError(result.error.message ?? "Could not disable two-factor.");
    } else {
      setTwoFactorEnabled(false);
      setBackupCodes(null);
    }
    setTotpPending(false);
    await refresh();
  };

  const revokeSession = async (token: string) => {
    setError(null);
    await authClient.revokeSession({ token });
    await refresh();
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-4 px-4 lg:px-6">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 px-4 lg:px-6">
      {error ? (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Passkeys</CardTitle>
          <CardDescription>
            Sign in and confirm sensitive changes without codes. Passkeys sync
            through iCloud Keychain or Google Password Manager, so they follow
            you to your other devices — we still recommend adding a second
            passkey on a different device or a hardware key.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {passkeys.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No passkeys yet. Add one to protect payouts and team changes.
            </p>
          ) : (
            <ul className="flex flex-col divide-y">
              {passkeys.map((pk) => (
                <li key={pk.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">
                      {pk.name || "Unnamed passkey"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Added {formatDate(pk.createdAt)}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {pk.backedUp ? <Badge variant="secondary">Synced</Badge> : null}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => deletePasskey(pk.id)}
                    >
                      Remove
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              placeholder='Name this passkey (e.g. "Front desk MacBook")'
              value={passkeyName}
              onChange={(e) => setPasskeyName(e.target.value)}
              className="sm:max-w-xs"
            />
            <Button onClick={addPasskey} disabled={addingPasskey}>
              {addingPasskey ? "Waiting for device…" : "Add passkey"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Authenticator app</CardTitle>
          <CardDescription>
            Fallback for when a passkey isn&apos;t available. Enabling this also
            issues one-time recovery codes — store them somewhere safe.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {twoFactorEnabled && !totpUri ? (
            <div className="flex items-center justify-between gap-3">
              <Badge>Enabled</Badge>
              <Button variant="outline" size="sm" onClick={disableTwoFactor} disabled={totpPending}>
                Disable
              </Button>
            </div>
          ) : null}

          {!twoFactorEnabled && !totpUri ? (
            <Button onClick={enableTwoFactor} disabled={totpPending} className="self-start">
              {totpPending ? "Setting up…" : "Set up authenticator app"}
            </Button>
          ) : null}

          {totpUri ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm">
                Add this account to your authenticator app (1Password, Google
                Authenticator, …) using the setup key below, then enter the
                6-digit code it shows to finish.
              </p>
              <code className="break-all rounded-md bg-muted px-3 py-2 text-xs">
                {totpUri}
              </code>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  placeholder="123456"
                  inputMode="numeric"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  className="sm:max-w-32"
                />
                <Button onClick={confirmTotp} disabled={totpPending || totpCode.trim().length < 6}>
                  Confirm
                </Button>
              </div>
            </div>
          ) : null}

          {backupCodes ? (
            <div className="flex flex-col gap-2">
              <Separator />
              <p className="text-sm font-medium">
                Recovery codes — shown once, save them now
              </p>
              <p className="text-xs text-muted-foreground">
                Each code works one time if you lose access to your passkeys and
                authenticator app.
              </p>
              <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                {backupCodes.map((code) => (
                  <code key={code} className="rounded bg-muted px-2 py-1 text-xs">
                    {code}
                  </code>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active sessions</CardTitle>
          <CardDescription>
            Everywhere this account is signed in. Revoke anything you don&apos;t
            recognise — the owners are also emailed whenever a new device signs
            in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col divide-y">
            {sessions.map((s) => (
              <li key={s.token} className="flex items-center justify-between gap-3 py-2">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">
                    {describeDevice(s.userAgent)}
                    {s.token === currentToken ? (
                      <Badge variant="secondary" className="ml-2">
                        This device
                      </Badge>
                    ) : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {s.ipAddress || "unknown IP"} · signed in {formatDate(s.createdAt)}
                  </span>
                </div>
                {s.token !== currentToken ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => revokeSession(s.token)}
                  >
                    Revoke
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
