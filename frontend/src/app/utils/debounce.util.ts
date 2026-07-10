export function debounce<T extends (...args: any[]) => void>(
  fn: T,
  delay: number
) {
  let timer: any;

  return function (this: any, ...args: Parameters<T>) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  } as T;
}
