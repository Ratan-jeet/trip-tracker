/** Tiny class joiner — avoids pulling in clsx for what is a one-liner. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
