"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type Theme = "dark" | "light";
const key = "forge-theme";
let fadeTimer: ReturnType<typeof setTimeout> | undefined;

export function ThemeToggle({ className = "" }: { className?: string }) {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const system = window.matchMedia("(prefers-color-scheme: dark)");
    function applyPreference() {
      const root = document.documentElement;
      let theme: Theme = system.matches ? "dark" : "light";
      if (root.dataset.themeChoice === "dark" || root.dataset.themeChoice === "light") theme = root.dataset.themeChoice;
      try {
        const saved = localStorage.getItem(key);
        if (saved === "light" || saved === "dark") theme = saved;
      } catch { /* The current document still has a usable preference. */ }
      document.documentElement.dataset.theme = theme;
      setDark(theme === "dark");
    }
    function syncToggle() { setDark(document.documentElement.dataset.theme === "dark"); }
    function syncStorage(change: StorageEvent) {
      if (change.key !== key && change.key !== null) return;
      delete document.documentElement.dataset.themeChoice;
      applyPreference();
    }
    applyPreference();
    system.addEventListener("change", applyPreference);
    window.addEventListener("storage", syncStorage);
    window.addEventListener("forge-theme-change", syncToggle);
    return () => {
      system.removeEventListener("change", applyPreference);
      window.removeEventListener("storage", syncStorage);
      window.removeEventListener("forge-theme-change", syncToggle);
    };
  }, []);

  function toggle() {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    const root = document.documentElement;
    root.dataset.themeChoice = next;
    root.dataset.themeChanging = "true";
    root.dataset.theme = next;
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => { delete root.dataset.themeChanging; }, 250);
    try { localStorage.setItem(key, next); } catch { /* Continue in memory. */ }
    window.dispatchEvent(new Event("forge-theme-change"));
  }
  return (
    <button type="button" className={`forge-theme-toggle ${className}`} aria-label="Dark theme"
      aria-pressed={dark} title={dark ? "Switch to light theme" : "Switch to dark theme"} onClick={toggle}>
      <Moon size={16} className="forge-theme-toggle__moon" aria-hidden="true" />
      <Sun size={17} className="forge-theme-toggle__sun" aria-hidden="true" />
    </button>
  );
}
