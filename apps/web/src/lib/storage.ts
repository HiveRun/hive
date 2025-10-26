/**
 * Type-safe localStorage wrapper with JSON serialization
 */
export const storage = {
  /**
   * Get a value from localStorage
   * @param key - The storage key
   * @returns The parsed value or null if not found
   */
  get: <T>(key: string): T | null => {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : null;
    } catch {
      return null;
    }
  },

  /**
   * Set a value in localStorage
   * @param key - The storage key
   * @param value - The value to store (will be JSON stringified)
   */
  set: <T>(key: string, value: T): void => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Silently fail - localStorage might be full or unavailable
    }
  },

  /**
   * Remove a value from localStorage
   * @param key - The storage key
   */
  remove: (key: string): void => {
    try {
      localStorage.removeItem(key);
    } catch {
      // Silently fail
    }
  },

  /**
   * Clear all values from localStorage
   */
  clear: (): void => {
    try {
      localStorage.clear();
    } catch {
      // Silently fail
    }
  },
};
