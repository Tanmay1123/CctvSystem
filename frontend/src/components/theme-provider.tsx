"use client";

import { createContext, useContext, useEffect, useState } from "react";

type Theme = "dark" | "light";

interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  toggle: () => {},
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");

  // Sync state with whatever the inline boot script already applied.
  useEffect(() => {
    const isDark = document.documentElement.classList.contains("dark");
    setThemeState(isDark ? "dark" : "light");
  }, []);

  const apply = (t: Theme) => {
    document.documentElement.classList.toggle("dark", t === "dark");
    try {
      localStorage.setItem("theme", t);
    } catch {
      /* ignore */
    }
    setThemeState(t);
  };

  return (
    <ThemeContext.Provider
      value={{ theme, setTheme: apply, toggle: () => apply(theme === "dark" ? "light" : "dark") }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
