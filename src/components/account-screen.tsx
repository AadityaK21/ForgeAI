"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Eye,
  EyeOff,
  Layers3,
  Braces,
  ScanLine,
  Check,
} from "lucide-react";
import styles from "./account.module.css";

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
      });
      if (!response.ok) {
        const body = await response.json();
        throw Error(body.error || "Please try again.");
      }
      window.location.replace("/");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to reach the workspace.",
      );
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <main className={styles.scene}>
      <header className={styles.head}>
        <Link href="/" className={styles.brand}>
          <i className={styles.mark} aria-hidden="true" />
          ForgeAI<span>by Merova</span>
        </Link>
        <Link href="/" className={styles.back}>
          Workspace <ArrowUpRight size={15} />
        </Link>
      </header>
      <div className={styles.layout}>
        <section className={styles.story} aria-label="ForgeAI builder workflow">
          <div className={styles.storyTop}>
            <i /> MEROVA / BUILD SYSTEM
          </div>
          <div className={styles.diagram} aria-hidden="true">
            <div className={styles.halo} />
            <div className={styles.orb} />
          </div>
          <div className={styles.storyText}>
            <small>THE BUILDER</small>
            <h2>
              From the first brief
              <br />
              to a working <em>app.</em>
            </h2>
            <div className={styles.path}>
              <span>
                <Layers3 size={14} />
                Plan
              </span>
              <ArrowRight size={13} />
              <span>
                <Braces size={14} />
                Build
              </span>
              <ArrowRight size={13} />
              <span>
                <ScanLine size={14} />
                Verify
              </span>
            </div>
          </div>
        </section>
        <section className={styles.formPane}>
          <div className={styles.formInner}>
            <small className={styles.eyebrow}>
              <span /> {signup ? "NEW WORKSPACE" : "WORKSPACE ACCESS"}
            </small>
            <h1>{signup ? "Create an account" : "Welcome back"}</h1>
            <p>
              {signup
                ? "Set up your ForgeAI workspace to save briefs, source files and build history."
                : "Sign in to pick up your projects where you left off."}
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
                placeholder="you@company.com"
                autoCapitalize="none"
                spellCheck={false}
              />
              <label htmlFor="account-password">Password</label>
              <div className={styles.password}>
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
                  aria-label={visible ? "Hide password" : "Show password"}
                  aria-pressed={visible}
                  onClick={() => setVisible(!visible)}
                >
                  {visible ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
              {signup && (
                <p id="password-tip" className={styles.tip}>
                  At least 8 characters with uppercase, lowercase, a number and
                  a symbol.
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
                  <p className={styles.tip}>
                    Use the code shared by the workspace owner.
                  </p>
                </>
              )}
              {error && (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              )}
              <button disabled={busy} className={styles.submit}>
                {busy
                  ? "Opening workspace…"
                  : signup
                    ? "Create account"
                    : "Sign in"}{" "}
                {busy ? <Check size={16} /> : <ArrowRight size={16} />}
              </button>
            </form>
            <p className={styles.switch}>
              {signup ? "Already have an account?" : "New to ForgeAI?"}{" "}
              <Link href={signup ? "/sign-in" : "/sign-up"}>
                {signup ? "Sign in" : "Create an account"}
              </Link>
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
