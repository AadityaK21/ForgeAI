"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
export function AccountScreen({
  signup,
  invited,
}: {
  signup: boolean;
  invited: boolean;
}) {
  const [visible, setVisible] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef(false);
  const id = signup ? "sign-up" : "sign-in";
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const data = new FormData(event.currentTarget);
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/" + id, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(data)),
        redirect: "error",
      });
      if (!response.ok) {
        const body = await response.json();
        throw Error(body.error || "Please try again.");
      }
      window.location.replace("/");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to sign in. Please try again.",
      );
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <main className="account-page">
      <header className="account-header">
        <Link href="/" className="wordmark">
          Merova AI
        </Link>
        <Link href="/">Back to chat</Link>
      </header>
      <section className="account-card" aria-labelledby="account-title">
        <h1 id="account-title">
          {signup ? "Create your account" : "Welcome back"}
        </h1>
        <p>
          {signup
            ? "A space for your ideas and conversations."
            : "Sign in to continue your conversations."}
        </p>
        <form method="post" action={"/api/auth/" + id} onSubmit={submit}>
          <label htmlFor="account-email">Email address</label>
          <input
            id="account-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            placeholder="you@example.com"
            autoCapitalize="none"
            spellCheck={false}
          />
          <label htmlFor="account-password">Password</label>
          <div className="password-field">
            <input
              id="account-password"
              name="password"
              type={visible ? "text" : "password"}
              autoComplete={signup ? "new-password" : "current-password"}
              minLength={signup ? 8 : 1}
              maxLength={256}
              required
              aria-describedby={signup ? "password-tip" : undefined}
            />
            <button
              type="button"
              className="icon-button"
              aria-label={visible ? "Hide password" : "Show password"}
              aria-pressed={visible}
              onClick={() => setVisible(!visible)}
            >
              {visible ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          {signup && (
            <p id="password-tip" className="account-tip">
              At least 8 characters, with uppercase, lowercase, a number and a
              symbol.
            </p>
          )}
          {signup && invited && (
            <>
              <label htmlFor="account-invite">Invitation code</label>
              <input
                id="account-invite"
                name="invite"
                type="password"
                required
                autoComplete="off"
                maxLength={1024}
              />
              <p className="account-tip">
                Merova AI is in a private pilot. Use the code shared by the
                owner.
              </p>
            </>
          )}
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <button disabled={busy} className="primary-button">
            {busy ? "Please wait…" : signup ? "Create account" : "Sign in"}
          </button>
        </form>
        <p className="account-switch">
          {signup ? "Already have an account?" : "New to Merova AI?"}{" "}
          <Link href={signup ? "/sign-in" : "/sign-up"}>
            {signup ? "Sign in" : "Create an account"}
          </Link>
        </p>
      </section>
    </main>
  );
}
