export function assertOwnerAuthUrl(value: string): void {
  const url = new URL(
    value,
    typeof location === "undefined" ? undefined : location.href,
  );
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/u.test(url.hostname);
  if (url.protocol === "https:" || (url.protocol === "http:" && loopback))
    return;
  throw new Error("Owner authentication requires HTTPS, except on loopback");
}
