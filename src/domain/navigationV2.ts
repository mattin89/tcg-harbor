/** Selects the most specific matching route so nested navigation stays honest. */
export function resolveActiveNavPathV2(
  pathname: string,
  routes: readonly string[],
  fallback: string,
): string {
  return [...routes]
    .sort((left, right) => right.length - left.length)
    .find((route) => pathname === route || pathname.startsWith(`${route}/`))
    ?? fallback;
}
