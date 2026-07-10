import { effect } from '@angular/core';
import { debounceTime, Subject } from 'rxjs';

export function debounceWatch<T>(
  source: () => T,
  callback: (value: T) => void,
  delay = 400
) {
  const subject = new Subject<T>();

  effect(() => {
    subject.next(source());
  });

  subject.pipe(debounceTime(delay)).subscribe(callback);
}
