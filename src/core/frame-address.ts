/** A stable frame address: HTTP(S) origin plus exact path, never a prefix or query token. */
export function frameOriginPath(href: string): string | undefined {
  const url = URL.canParse(href) ? new URL(href) : undefined;
  return url && (url.protocol === "http:" || url.protocol === "https:")
    ? `${url.origin}${url.pathname}`
    : undefined;
}
