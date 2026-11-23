import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  resolveInterfaceLanguage,
  type InterfaceLanguage,
  type ResolvedInterfaceLanguage,
} from "@bb/domain";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import {
  translateInterfaceText,
  type InterfaceTranslator,
} from "./interface-translations";

const LanguageContext = createContext<ResolvedInterfaceLanguage>("en");

function subscribeToSystemLanguage(notify: () => void) {
  window.addEventListener("languagechange", notify);
  return () => window.removeEventListener("languagechange", notify);
}

function systemLanguages() {
  return navigator.languages.length > 0
    ? navigator.languages.join(",")
    : navigator.language;
}

function serverLanguages() {
  return "en";
}

export function InterfaceLanguageProvider({
  preference,
  children,
}: {
  preference: InterfaceLanguage;
  children: ReactNode;
}) {
  const languages = useSyncExternalStore(
    subscribeToSystemLanguage,
    systemLanguages,
    serverLanguages,
  );
  const language = resolveInterfaceLanguage(preference, languages.split(","));

  useEffect(() => {
    const previous = document.documentElement.lang;
    return () => {
      document.documentElement.lang = previous;
    };
  }, []);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  return (
    <LanguageContext.Provider value={language}>
      {children}
    </LanguageContext.Provider>
  );
}

export function AppLanguageProvider({ children }: { children: ReactNode }) {
  const config = useSystemConfig();
  return (
    <InterfaceLanguageProvider
      preference={config.data?.generalSettings.interfaceLanguage ?? "system"}
    >
      {children}
    </InterfaceLanguageProvider>
  );
}

export function useInterfaceTranslation() {
  const language = useContext(LanguageContext);
  const t = useCallback<InterfaceTranslator>(
    (message, values) => translateInterfaceText(message, language, values),
    [language],
  );
  return { language, t };
}
