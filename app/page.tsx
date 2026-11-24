import { auth } from "@/auth";
import { gmailAllowed } from "@/lib/gmailAccess";
import { App } from "./ui/App";
import { SignIn } from "./ui/SignIn";

// Everyone signs in with Google first. Cards and payments still stay on the phone.
export default async function Page() {
  const session = await auth();
  const user = session?.user;
  if (!user?.email) return <SignIn />;
  return (
    <App
      user={{ id: user.id ?? user.email, name: user.name ?? "", email: user.email, image: user.image ?? undefined }}
      // Gmail sync is only for allowlisted accounts (see lib/gmailAccess.ts). Others get no client ID at all.
      gmailClientId={gmailAllowed(user.email) ? process.env.AUTH_GOOGLE_ID : undefined}
    />
  );
}
