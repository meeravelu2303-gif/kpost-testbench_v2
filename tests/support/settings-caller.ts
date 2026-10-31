import { apiRegistry } from '@api/definitions/index';
import { AUTH_PROFILES } from '@config/auth-profile';

/**
 * The KPost ID the Settings endpoints sign in as. They name their own principal (`personal-5`, so
 * the engine's write fuzz never lands on the primary account; settings-endpoint.ts), so a flow that
 * checks the settings row must read that account's row, not the primary's.
 */
export function settingsCallerKpostId(): string | undefined {
  const key = apiRegistry.get('settings-font').authentication?.principalKey;
  return AUTH_PROFILES.kpost.principals.find((p) => p.key === key)?.username || undefined;
}
