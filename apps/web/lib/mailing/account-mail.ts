import { composeActionMail, escapeHtml, getEmailClient, type ActionMail } from "@openbookings/mailing";

const DEFAULT_FROM = "Roy at OpenBookings <noreply@openbookings.co>";
const FROM_ADDRESS = process.env.EMAIL_FROM_ADDRESS ?? process.env.MAGIC_LINK_FROM ?? DEFAULT_FROM;

export type AccountMail = ActionMail;
const compose = composeActionMail;

const NOT_YOU =
  'Didn\'t ask for this? Ignore this email and nothing changes. Worried? Email <a href="mailto:support@openbookings.co" style="color:#AAAAAA;text-decoration:underline;">support@openbookings.co</a>.';

/** Sent to the CURRENT address: confirm the move before anything changes. */
export function emailChangeConfirmation(newEmail: string, url: string): AccountMail {
  return compose({
    subject: "Confirm your new email address",
    preheader: "Confirm the change to your sign-in email.",
    eyebrow: "Account",
    headline: "Change your<br />sign-in email?",
    body: `You asked to sign in with <strong style="color:#DDDDDD;">${escapeHtml(newEmail)}</strong> from now on. Confirm here, then we'll send a link to the new address to finish.`,
    ctaUrl: url,
    ctaLabel: "Confirm the change",
    footnote: NOT_YOU,
  });
}

/** Sent to the NEW address, second step of a change. */
export function newEmailVerification(url: string): AccountMail {
  return compose({
    subject: "Verify your email address",
    preheader: "One click and this address is your sign-in email.",
    eyebrow: "Account",
    headline: "Verify your<br />email address.",
    body: "Open this link to start signing in to OpenBookings with this address.",
    ctaUrl: url,
    ctaLabel: "Verify this address",
    footnote: NOT_YOU,
  });
}

export function deleteAccountConfirmation(url: string): AccountMail {
  return compose({
    subject: "Confirm you want to delete your account",
    preheader: "Your account is deleted only after you confirm.",
    eyebrow: "Account",
    headline: "Delete your<br />account?",
    body: "This removes your profile, passkeys and sign-ins. Booking records stay for seven years because Dutch tax law requires it. This can't be undone.",
    ctaUrl: url,
    ctaLabel: "Delete my account",
    footnote: NOT_YOU,
  });
}

export function passkeyAdded(name: string, securityUrl: string): AccountMail {
  return compose({
    subject: "A passkey was added to your account",
    preheader: "You can now sign in with this passkey.",
    eyebrow: "Security",
    headline: "A passkey<br />was added.",
    body: `<strong style="color:#DDDDDD;">${escapeHtml(name)}</strong> can now sign in to your account. If that was you, there's nothing to do.`,
    ctaUrl: securityUrl,
    ctaLabel: "Review your passkeys",
    footnote:
      'Wasn\'t you? Remove the passkey and sign out other sessions, then email <a href="mailto:support@openbookings.co" style="color:#AAAAAA;text-decoration:underline;">support@openbookings.co</a>.',
  });
}

export async function sendAccountMail(to: string, mail: AccountMail): Promise<void> {
  await getEmailClient().from(FROM_ADDRESS).to(to).subject(mail.subject).html(mail.html).send();
}
