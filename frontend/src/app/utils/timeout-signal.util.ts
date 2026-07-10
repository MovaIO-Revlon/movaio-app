import { signal, WritableSignal } from '@angular/core';

export function timeoutSignal<T>(
  initialValue: T,
): WritableSignal<T> & { trigger: (value: T, durationMs?: number) => void } {
  const sig = signal<T>(initialValue) as any;
  let timeoutId: any = null;

  sig.trigger = (value: T, durationMs: number = 5000) => {
    if (timeoutId) clearTimeout(timeoutId);

    sig.set(value);

    timeoutId = setTimeout(() => {
      sig.set(initialValue);
    }, durationMs);
  };

  return sig;
}
