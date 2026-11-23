// Never request a redacted address or allow executable schemes in page-provided links.
export function resourceURL(value?: string): string | undefined {
  if (!value || /\[redacted|%5Bredacted/i.test(value)) return undefined;
  try {
    const url = new URL(value);
    if (url.username || url.password) return undefined;
    if (["http:", "https:", "blob:", "file:"].includes(url.protocol) || /^data:image\//i.test(value)) return value;
  } catch { /* Relative and malformed URLs have no reliable resource target. */ }
  return undefined;
}
