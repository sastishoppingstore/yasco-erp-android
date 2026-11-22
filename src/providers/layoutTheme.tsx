import { createContext, useContext, type ReactNode } from "react";

export type LayoutTheme = "sidebar" | "app_launcher" | "launcher_theme";

interface LayoutThemeContextValue {
  layoutTheme: LayoutTheme;
  setLayoutTheme: (theme: LayoutTheme) => void;
  isAppLauncher: boolean;
  isLoading: boolean;
}

const LayoutThemeContext = createContext<LayoutThemeContextValue>({
  layoutTheme: "launcher_theme",
  setLayoutTheme: () => {},
  isAppLauncher: true,
  isLoading: true,
});

export function LayoutThemeProvider({ children }: { children: ReactNode }) {
  // Theme is locked to the launcher layout for every tenant, so there is no
  // need to call the authenticated `settings.themeGet` endpoint here. Removing
  // that call also stops an expected pre-login 401 on /login & /register.
  const setLayoutTheme = (_theme: LayoutTheme) => {};

  return (
    <LayoutThemeContext.Provider
      value={{
        layoutTheme: "launcher_theme",
        setLayoutTheme,
        isAppLauncher: true,
        isLoading: false,
      }}
    >
      {children}
    </LayoutThemeContext.Provider>
  );
}

export function useLayoutTheme() {
  return useContext(LayoutThemeContext);
}
