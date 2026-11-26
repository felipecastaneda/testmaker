import { getApp, getApps, initializeApp } from "firebase/app";
import {
  browserPopupRedirectResolver,
  connectAuthEmulator,
  GoogleAuthProvider,
  inMemoryPersistence,
  initializeAuth,
  signInWithPopup,
  signOut,
  type Auth,
} from "firebase/auth";
import { firebaseConfig } from "./firebase";

/*
 * Student sign-in (browser only). A separate Firebase app instance with in-memory persistence:
 * a student's Google sign-in never replaces a professor's session in the same browser, and
 * nothing stays signed in on a shared lab computer. The ID token is only sent once, to join;
 * the exam then runs on its attempt token.
 */

const APP_NAME = "students";
let auth: Auth | undefined;

function studentAuth(): Auth {
  if (!auth) {
    const app = getApps().some((a) => a.name === APP_NAME) ? getApp(APP_NAME) : initializeApp(firebaseConfig, APP_NAME);
    auth = initializeAuth(app, { persistence: inMemoryPersistence, popupRedirectResolver: browserPopupRedirectResolver });
    const emulatorHost = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST;
    if (emulatorHost) connectAuthEmulator(auth, `http://${emulatorHost}`, { disableWarnings: true });
  }
  return auth;
}

export interface StudentAccount {
  email: string;
  name: string;
  idToken: string;
}

/** Google sign-in in a pop-up. With one allowed domain, Google's account picker is limited to it. Null if the student closed the pop-up. */
export async function signInStudentWithGoogle(domains: string[]): Promise<StudentAccount | null> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account", ...(domains.length === 1 ? { hd: domains[0] } : {}) });
  try {
    const { user } = await signInWithPopup(studentAuth(), provider);
    return { email: user.email ?? "", name: user.displayName ?? "", idToken: await user.getIdToken() };
  } catch (error) {
    const code = (error as { code?: string }).code ?? "";
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return null;
    if (code === "auth/popup-blocked") throw new Error("Your browser blocked the sign-in pop-up. Allow pop-ups for this site and try again.");
    if (code === "auth/unauthorized-domain") throw new Error("Sign-in isn't set up for this web address. Tell your professor.");
    throw new Error("Couldn't sign in with Google. Try again.");
  }
}

/** A fresh ID token for the signed-in student (tokens last an hour). */
export async function studentIdToken(): Promise<string | null> {
  return (await studentAuth().currentUser?.getIdToken()) ?? null;
}

export async function signOutStudent(): Promise<void> {
  if (auth) await signOut(auth);
}
