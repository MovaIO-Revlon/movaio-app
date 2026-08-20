export interface JwtPayload {
  iss?: string;
  sub?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  iat?: number;
  jti?: string;
  [key: string]: unknown;
}

export function decodeJWT<T extends JwtPayload = JwtPayload>(
  token: string,
): T | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT format');
    }

    const payloadBase64Url = parts[1];

    const base64 = payloadBase64Url.replace(/-/g, '+').replace(/_/g, '/');
    const decodedString = decodeURIComponent(escape(window.atob(base64)));

    return JSON.parse(decodedString) as T;
  } catch (error) {
    console.error('Failed to decode JWT', error);
    return null;
  }
}
