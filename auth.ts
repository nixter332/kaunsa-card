// Google sign-in (Auth.js). Sessions live in a signed cookie, so there's no user database:
// the app only learns each person's Google name and email, to know who is using it.
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google], // reads AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET
  trustHost: true,
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 180 }, // stay signed in for 6 months
  callbacks: {
    session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub; // Google's stable account id
      return session;
    },
  },
});
