/**
 * StorageService — wraps localStorage with a unified 'waw_' key prefix.
 * Provides JSON encode/decode with error-tolerant fallbacks.
 */

const KEYS = {
  PROVIDER: 'waw_provider',
  API_KEY:  'waw_apikey',
  BASE_URL: 'waw_baseurl',
  MODEL:    'waw_model',
  DRAFT:    'waw_draft',
}

function safeGet(key) {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return null
    return JSON.parse(raw)
  } catch (err) {
    console.warn('[storageService] Failed to read:', key, err)
    return null
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (err) {
    console.warn('[storageService] Failed to write:', key, err)
  }
}

export const storageService = {
  /** Save canvas-editor document data as draft. */
  saveDraft(canvasData) {
    safeSet(KEYS.DRAFT, canvasData)
  },

  /** Load previously saved draft, or null if none exists. */
  loadDraft() {
    return safeGet(KEYS.DRAFT)
  },

  /** Returns true if a saved draft exists. */
  hasDraft() {
    return localStorage.getItem(KEYS.DRAFT) !== null
  },

  /** Remove only the draft entry. */
  clearDraft() {
    localStorage.removeItem(KEYS.DRAFT)
  },

  /** Remove all waw_* entries (draft + config). */
  clearAll() {
    Object.values(KEYS).forEach(k => localStorage.removeItem(k))
  },
}
