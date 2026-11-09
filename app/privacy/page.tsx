import type { Metadata } from "next";
import { CONTACT_EMAIL } from "./contact";

export const metadata: Metadata = { title: "Privacy policy · Kaunsa Card" };

const UPDATED = "9 November 2026";

export default function Privacy() {
  return (
    <main className="app">
      <article className="screen legal">
        <a href="/" className="linkish">
          ← Kaunsa Card
        </a>
        <h1 className="title">Privacy policy</h1>
        <p className="muted small">Last updated {UPDATED}</p>

        <p>
          Kaunsa Card helps you pick which of your credit cards to use for a payment. It is a personal project, not a bank or a financial
          advisor. This page explains what it collects and why.
        </p>

        <h2>What we collect</h2>
        <ul>
          <li>
            <strong>Your Google name, email and account ID</strong>, when you sign in with Google, so we know who is using the app. We don&apos;t
            get your password or access to anything else in your Google account.
          </li>
          <li>
            <strong>How you use the app</strong>: which cards you add, what you look up (for typed lookups, the first 80 characters, like
            &ldquo;zomato 650&rdquo;), which card you said you paid with, and any feedback you send. This is linked to your name and email.
          </li>
          <li>
            <strong>Share links</strong>: when you share an answer, the link has a random code, not your name or email. If someone signs up from
            your link, we can see that your link brought them in. What you share is up to you; the answer is written into the message on your phone.
          </li>
          <li>
            <strong>Card advisor answers</strong>: your income range and monthly spending stay on your phone. Analytics only get the income range, a
            rounded total, which spending types you filled in, and which cards were suggested.
          </li>
          <li>
            <strong>Basic device information</strong> such as browser, device type and approximate city (from your IP address), recorded by our
            analytics tool.
          </li>
        </ul>

        <h2>What we never collect</h2>
        <p>Card numbers, CVVs, bank logins, account balances or statements. The app never connects to your bank.</p>

        <h2>Where your data lives</h2>
        <ul>
          <li>
            <strong>On your phone:</strong> the cards you hold and the payments you log are stored in your browser, not on our servers. Clearing
            the app&apos;s data (Settings → Clear all my data) removes them.
          </li>
          <li>
            <strong>PostHog</strong> (EU servers) stores usage events for analytics.
          </li>
          <li>
            <strong>Anthropic (Claude)</strong> reads the text you type, like &ldquo;dinner 2400&rdquo;, to understand the payment. It is not
            used to train their models.
          </li>
          <li>
            <strong>Vercel</strong> hosts the app, and <strong>Upstash</strong> keeps a daily count of AI lookups per account (deleted after about
            a day) to stop overuse.
          </li>
        </ul>

        <h2>Your choices</h2>
        <ul>
          <li>Turn off usage stats any time in Settings → Share usage stats.</li>
          <li>Sign out from Settings. Signing in is needed to use the app.</li>
          <li>
            To see or delete what we hold about you, email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. We&apos;ll act on it within 30
            days.
          </li>
        </ul>

        <h2>What we don&apos;t do</h2>
        <p>We don&apos;t sell your data, show ads, or share it with banks or card issuers.</p>

        <h2>Changes</h2>
        <p>If this policy changes, we&apos;ll update the date above.</p>
      </article>
    </main>
  );
}
