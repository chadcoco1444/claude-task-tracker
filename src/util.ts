export function basename(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p;
}

export function shortId(session: string): string {
  return session.split('-')[0] || session;
}
