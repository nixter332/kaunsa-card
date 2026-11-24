"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/auth";
import { GUEST_COOKIE, GUEST_COOKIE_MAX_AGE } from "@/lib/guest";

export async function signInWithGoogle() {
  await signIn("google", { redirectTo: "/" });
}

export async function signOutOfApp() {
  await signOut({ redirectTo: "/" });
}

/** "Try it now": use the app without signing in. Remembered on this browser, so the next visit opens the app. */
export async function startGuest() {
  (await cookies()).set(GUEST_COOKIE, "1", {
    maxAge: GUEST_COOKIE_MAX_AGE,
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
  redirect("/");
}
