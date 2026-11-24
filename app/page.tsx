import { cookies } from "next/headers";
import { auth } from "@/auth";
import { gmailAllowed } from "@/lib/gmailAccess";
import { GUEST_COOKIE } from "@/lib/guest";
import { App } from "./ui/App";
import { Landing } from "./ui/SignIn";

// Signed in: the full app. Tried it before without signing in: straight into the app as a guest (on-device reading
// only, no AI). Otherwise the landing screen: "Try it now", or sign in with Google.
// Cards and payments stay on the phone either way.
export default async function Page() {
  const session = await auth();
  const user = session?.user;
  if (user?.email) {
    return (
      <App
        user={{ id: user.id ?? user.email, name: user.name ?? "", email: user.email, image: user.image ?? undefined }}
        // Gmail sync is only for allowlisted accounts (see lib/gmailAccess.ts). Others get no client ID at all.
        gmailClientId={gmailAllowed(user.email) ? process.env.AUTH_GOOGLE_ID : undefined}
      />
    );
  }
  if ((await cookies()).get(GUEST_COOKIE)?.value === "1") return <App />;
  return <Landing />;
}
