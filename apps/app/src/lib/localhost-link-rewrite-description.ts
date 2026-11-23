import { rewriteLocalhostLinkHref } from "@bb/client-core";
import type { ResolvedInterfaceLanguage } from "@bb/domain";
import { translateInterfaceText } from "./interface-translations";

const EXAMPLE_HREF = "http://localhost:3000/";

export function localhostLinkRewriteDescription(
  currentHostname: string | undefined,
  language: ResolvedInterfaceLanguage = "en",
): string | null {
  if (currentHostname === undefined) {
    return null;
  }

  const rewrittenHref = rewriteLocalhostLinkHref({
    currentHostname,
    enabled: true,
    href: EXAMPLE_HREF,
  });
  if (rewrittenHref === undefined || rewrittenHref === EXAMPLE_HREF) {
    return null;
  }

  return translateInterfaceText(
    "When enabled, localhost URLs are rewritten to use the same host or IP address you use to open BB. For example: {source} → {target}",
    language,
    { source: EXAMPLE_HREF, target: rewrittenHref },
  );
}
