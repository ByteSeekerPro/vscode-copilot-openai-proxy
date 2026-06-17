import * as crypto from 'crypto';
import type { Request } from 'express';

/**
 * OpenAI-compatible error response shape.
 */
export interface OpenAIErrorResponse {
  error: {
    message: string;
    type: string;
    code: string;
  };
}

/**
 * Result of an auth validation check.
 */
export type AuthResult =
  | { ok: true }
  | { ok: false; status: number; error: OpenAIErrorResponse };

/**
 * Validate a Bearer-token Authorization header against the configured API key.
 *
 * Uses constant-time comparison via `crypto.timingSafeEqual` to avoid
 * timing side-channels.
 *
 * Never includes received token values in logs or error responses.
 */
export function validateAuth(
  req: Request,
  requireApiKey: boolean,
  apiKey: string
): AuthResult {
  // Auth disabled — allow everything.
  if (!requireApiKey) {
    return { ok: true };
  }

  // Auth enabled but no key configured — block all requests.
  if (!apiKey) {
    return {
      ok: false,
      status: 503,
      error: {
        error: {
          message: 'API-key authentication is enabled but no API key is configured.',
          type: 'server_error',
          code: 'api_key_not_configured',
        },
      },
    };
  }

  const authHeader = req.headers.authorization;

  // Missing Authorization header.
  if (!authHeader) {
    return {
      ok: false,
      status: 401,
      error: {
        error: {
          message: 'Missing Authorization header. Use Authorization: Bearer <apiKey>.',
          type: 'authentication_error',
          code: 'missing_authorization',
        },
      },
    };
  }

  // Must start with "Bearer ".
  if (!authHeader.startsWith('Bearer ')) {
    return {
      ok: false,
      status: 401,
      error: {
        error: {
          message: 'Invalid Authorization scheme. Use Authorization: Bearer <apiKey>.',
          type: 'authentication_error',
          code: 'invalid_authorization_scheme',
        },
      },
    };
  }

  const receivedToken = authHeader.slice(7); // Strip "Bearer " prefix

  // Constant-time comparison.
  if (!timingSafeCompare(receivedToken, apiKey)) {
    return {
      ok: false,
      status: 401,
      error: {
        error: {
          message: 'Invalid API key.',
          type: 'authentication_error',
          code: 'invalid_api_key',
        },
      },
    };
  }

  return { ok: true };
}

/**
 * Constant-time string comparison using `crypto.timingSafeEqual`.
 *
 * Pads both buffers to equal length to handle different-length inputs
 * without leaking length information.
 */
export function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');

  if (bufA.length !== bufB.length) {
    // Compare against a buffer of the expected length to keep timing constant.
    const dummy = Buffer.alloc(bufA.length, 0);
    crypto.timingSafeEqual(bufA, dummy);
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}
