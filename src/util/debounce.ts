export function debounce<T extends (...args: any[]) => void>(fn: T, delayMs: number): T {
  let handle: NodeJS.Timeout | undefined;
  return ((...args: Parameters<T>) => {
    if (handle) {
      clearTimeout(handle);
    }
    handle = setTimeout(() => fn(...args), delayMs);
  }) as T;
}
