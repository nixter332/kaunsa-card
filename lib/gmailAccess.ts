// Who may use "Payments from Gmail". Gmail sync needs Google's restricted gmail.readonly scope, and until Google
// verifies the app, everyone who reaches that consent screen sees an "unverified app" warning and counts toward a
// lifetime cap of 100 users for the whole Google project. So it's on only for the accounts listed in
// GMAIL_SYNC_EMAILS (comma-separated). Not set or empty means nobody: it fails closed.
// Checked on the server (app/page.tsx). Everyone else's page never gets the client ID, so it can't load
// Google's Gmail script or ask for Gmail access.

export function gmailSyncEmails(list = process.env.GMAIL_SYNC_EMAILS): Set<string> {
  return new Set(
    (list ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.includes("@")),
  );
}

export function gmailAllowed(email: string | null | undefined, list = process.env.GMAIL_SYNC_EMAILS): boolean {
  if (!email) return false;
  return gmailSyncEmails(list).has(email.trim().toLowerCase());
}
