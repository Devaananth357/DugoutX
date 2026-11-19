"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  updateProfile,
} from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, firestore } from "@/lib/firebase";

function authMessage(error: unknown) {
  const code = typeof error === "object" && error && "code" in error
    ? String(error.code)
    : "";
  const messages: Record<string, string> = {
    "auth/email-already-in-use": "An account already exists for this email.",
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/weak-password": "Choose a stronger password.",
    "auth/too-many-requests": "Too many attempts. Please wait and try again.",
    "auth/operation-not-allowed": "Google sign-in is not enabled in Firebase yet.",
    "auth/popup-closed-by-user": "Google sign-in was cancelled.",
    "auth/popup-blocked": "Allow pop-ups for this website and try again.",
    "auth/unauthorized-domain": "This device address is not authorized in Firebase.",
  };
  return messages[code] ?? "Authentication failed. Please try again.";
}

export function SignupForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"signup"|"signin">("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const form=new FormData(event.currentTarget);
    const password=String(form.get("password")||"");
    try {
      const credential = mode === "signup"
        ? await createUserWithEmailAndPassword(auth, email.trim(), password)
        : await signInWithEmailAndPassword(auth, email.trim(), password);
      if (mode === "signup") {
        await updateProfile(credential.user, { displayName: name.trim() });
        try {
          await setDoc(doc(firestore, "users", credential.user.uid), {
            name: name.trim(),
            email: credential.user.email,
            createdAt: serverTimestamp(),
          });
        } catch (profileError) {
          console.warn("Firebase profile sync failed.", profileError);
        }
      }
      const managerName = mode === "signup"
        ? name.trim()
        : credential.user.displayName || credential.user.email?.split("@")[0] || "Manager";
      window.localStorage.setItem("dugoutx_user", JSON.stringify({
        id: credential.user.uid,
        name: managerName,
        email: credential.user.email,
      }));
      router.push("/seasons");
    } catch (authError) {
      setError(authMessage(authError));
    } finally {
      setBusy(false);
    }
  }
  async function signInWithGoogle() {
    setError("");
    setBusy(true);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      const credential = await signInWithPopup(auth, provider);
      const managerName = credential.user.displayName || credential.user.email?.split("@")[0] || "Manager";
      try {
        await setDoc(doc(firestore, "users", credential.user.uid), {
          name: managerName,
          email: credential.user.email,
          photoURL: credential.user.photoURL,
          lastSignedInAt: serverTimestamp(),
        }, { merge: true });
      } catch (profileError) {
        console.warn("Firebase profile sync failed.", profileError);
      }
      window.localStorage.setItem("dugoutx_user", JSON.stringify({
        id: credential.user.uid,
        name: managerName,
        email: credential.user.email,
        photoURL: credential.user.photoURL,
      }));
      router.push("/seasons");
    } catch (authError) {
      setError(authMessage(authError));
    } finally {
      setBusy(false);
    }
  }
  return <form className="auth-form" onSubmit={submit}>
    <button className="google-auth-button" type="button" disabled={busy} onClick={signInWithGoogle}>
      <span className="google-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.41Z"/><path fill="#34A853" d="M12 22c2.7 0 4.97-.9 6.62-2.36l-3.24-2.54c-.9.6-2.05.96-3.38.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.39 13.93A6 6 0 0 1 6.08 12c0-.67.12-1.32.31-1.93V7.45H3.04A10 10 0 0 0 2 12c0 1.61.39 3.14 1.04 4.55l3.35-2.62Z"/><path fill="#EA4335" d="M12 5.94c1.47 0 2.79.5 3.83 1.5L18.7 4.56A9.63 9.63 0 0 0 12 2a10 10 0 0 0-8.96 5.45l3.35 2.62C7.18 7.7 9.39 5.94 12 5.94Z"/></svg></span>
      <span className="google-copy"><small>QUICK ACCESS</small><strong>Continue with Google</strong></span>
      <i>↗</i>
    </button>
    <div className="auth-divider"><span>OR USE EMAIL</span></div>
    {mode==="signup"&&<label>Manager name<input value={name} onChange={event=>setName(event.target.value)} required placeholder="Your name" autoComplete="name" /></label>}
    <label>Email address<input value={email} onChange={event=>setEmail(event.target.value)} required type="email" placeholder="you@example.com" autoComplete="email" /></label>
    <label>Password<input name="password" required type="password" minLength={8} placeholder="Minimum 8 characters" autoComplete={mode==="signup"?"new-password":"current-password"} /></label>
    {error&&<p className="auth-error">{error}</p>}
    <button type="submit" disabled={busy}>{busy?"Please wait…":mode==="signup"?"Create account":"Sign in"} <span>→</span></button>
    <p>{mode==="signup"?"Already registered? ":"Need an account? "}<button type="button" onClick={()=>{setMode(mode==="signup"?"signin":"signup");setError("");}}>{mode==="signup"?"Sign in":"Create account"}</button></p>
  </form>;
}
