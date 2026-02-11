/**
 * Utility for formatting player names
 */

/**
 * Format name from "Last, First" to "First Last"
 */
export function formatNameFirstLast(name: string | null): string {
  if (!name || name === 'Loading...' || name === 'Unknown') return name || '';
  const commaIndex = name.indexOf(',');
  if (commaIndex === -1) return name;
  return `${name.slice(commaIndex + 1).trim()} ${name.slice(0, commaIndex).trim()}`;
}

/**
 * Format name from "Last, First" to "F. Last"
 */
export function formatNameInitialLast(name: string | null): string {
  if (!name || name === 'Loading...' || name === 'Unknown') return name || '';
  const commaIndex = name.indexOf(',');
  if (commaIndex === -1) return name;
  const lastName = name.slice(0, commaIndex).trim();
  const firstName = name.slice(commaIndex + 1).trim();
  return `${firstName.charAt(0)}. ${lastName}`;
}
