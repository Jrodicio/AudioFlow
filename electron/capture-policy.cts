/** Electron 42 marks desktop requests with an empty device mediaTypes list.
 * Device requests (audio / video) must never be granted by this application. */
export function isCapturePermission(permission: string, mediaTypes?: readonly string[]): boolean {
  return permission === 'display-capture' || (permission === 'media' && mediaTypes?.length === 0);
}
