export interface CookieOptions {
  expires?: number | Date;
  path?: string;
  domain?: string;
  secure?: boolean;
  sameSite?: 'Lax' | 'Strict' | 'None';
}

const isBrowser = typeof document !== 'undefined';

export const setCookie = (
  name: string,
  value: string,
  options?: CookieOptions,
): void => {
  if (!isBrowser) return;

  let cookieString = `${encodeURIComponent(name)}=${encodeURIComponent(value)};`;

  if (options) {
    if (options.expires) {
      if (typeof options.expires === 'number') {
        const date = new Date();
        date.setTime(date.getTime() + options.expires * 24 * 60 * 60 * 1000);
        cookieString += `expires=${date.toUTCString()};`;
      } else {
        cookieString += `expires=${options.expires.toUTCString()};`;
      }
    }

    if (options.path) {
      cookieString += `path=${options.path};`;
    } else {
      cookieString += `path=/;`;
    }

    if (options.domain) {
      cookieString += `domain=${options.domain};`;
    }

    if (options.secure) {
      cookieString += `secure;`;
    }

    if (options.sameSite) {
      cookieString += `samesite=${options.sameSite};`;
    }
  } else {
    cookieString += `path=/;`;
  }

  document.cookie = cookieString;
};

export const getCookie = (name: string): string | null => {
  if (!isBrowser) return null;

  const nameEQ = encodeURIComponent(name) + '=';
  const ca = document.cookie.split(';');

  for (let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) === ' ') {
      c = c.substring(1, c.length);
    }
    if (c.indexOf(nameEQ) === 0) {
      return decodeURIComponent(c.substring(nameEQ.length, c.length));
    }
  }
  return null;
};

export const deleteCookie = (
  name: string,
  path: string = '/',
  domain?: string,
): void => {
  if (!isBrowser) return;

  setCookie(name, '', {
    expires: -1,
    path: path,
    domain: domain,
  });
};

export const checkCookie = (name: string): boolean => {
  return getCookie(name) !== null;
};
