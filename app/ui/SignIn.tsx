import { signInWithGoogle } from "../actions";
import { CardTile } from "./CardTile";
import { cardById } from "./store";
import { SignInButton, SignInTracking } from "./SignInParts";

export function SignIn() {
  const fan = ["flipkart-axis", "swiggy-hdfc", "hsbc-live-plus"].map(cardById).filter(Boolean);
  return (
    <main className="app">
      <SignInTracking />
      <div className="onboard">
        <div className="onboard-step">
          <div className="fan" aria-hidden="true">
            {fan.map(
              (c, i) =>
                c && (
                  <div key={c.id} className={`fan-${i}`}>
                    <CardTile card={c} size="md" />
                  </div>
                ),
            )}
          </div>
          <h1 className="onboard-title">Kaunsa Card?</h1>
          <p className="onboard-lead">Tell it what you&apos;re paying for. It tells you which of your cards gives the most back, bank offers included.</p>
          <form action={signInWithGoogle} className="onboard-actions">
            <SignInButton>
              <GoogleG /> Continue with Google
            </SignInButton>
          </form>
          <p className="fine center">
            We only get your name and email, to know who&apos;s using Kaunsa Card. Your cards and payments stay on this phone. No bank login, ever. <a href="/privacy" className="linkish">Privacy policy</a>
          </p>
        </div>
      </div>
    </main>
  );
}

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.6 13.2l7.8 6.1C12.3 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
      <path fill="#FBBC05" d="M10.4 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6.1C.9 16.6 0 20.2 0 24s.9 7.4 2.6 10.8l7.8-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.7-4.1-13.6-9.8l-7.8 6.1C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}
