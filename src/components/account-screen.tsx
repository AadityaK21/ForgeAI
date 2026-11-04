"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Eye, EyeOff } from "lucide-react";
import { ForgeMark } from "./forge-mark";
import { ThemeToggle } from "./theme-toggle";
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
        <Link href="/" className={styles.brand} aria-label="ForgeAI workspace">
          <ForgeMark /> ForgeAI <span>by Merova</span>
        </Link>
        <div className={styles.headerTools}>
          <Link href="/" className={styles.back}><ArrowLeft size={15} /> Workspace</Link>
          <ThemeToggle />
        </div>
      </header>
      <div className={styles.layout}>
        <section className={styles.formPane} aria-labelledby="account-title">
          <div className={styles.formInner}>
            <small className={styles.eyebrow}>/ {signup ? "New account" : "Workspace access"}</small>
            <h1 id="account-title">{signup ? "Create an account." : "Sign in."}</h1>
            <p className={styles.intro}>
              {signup ? "Keep your briefs, source files and build history together."
                : "Open your saved projects and pick up your last build."}
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
                {busy ? <span className={styles.busyDot} aria-hidden="true" /> : <ArrowRight size={16} />}
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
        <aside className={styles.sheet} aria-labelledby="sheet-title">
          <div className={styles.sheetTop}><span>Merova / ForgeAI</span><span>Fig. {signup ? "02" : "01"}</span></div>
          <div className={styles.drawing} aria-hidden="true">
            <i className={styles.register} /><ForgeMark className={styles.figure} />
            <i className={styles.cross} />
          </div>
          <div className={styles.sheetCopy}>
            <small className={styles.eyebrow}>/ {signup ? "First build" : "Project archive"}</small>
            <h2 id="sheet-title">{signup ? "Begin with a brief." : "Keep building."}</h2>
            <p>{signup ? "Describe the first thing someone should be able to do in your app." :
              "Return to a blueprint, inspect the source, or open the preview."}</p>
          </div>
          <div className={styles.sheetFoot}><span>01 / Plan</span><span>02 / Build</span><span>03 / Inspect</span></div>
        </aside>
      </div>
    </main>
  );
}
