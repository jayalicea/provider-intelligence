// User-curated provider watchlist: localStorage persistence plus a shareable
// URL token. No dependencies. Shape (version 1):
//   { version: 1, npis: string[], addedAt: { [npi]: ISO date string } }
// Storage key: 'providerlens.watchlist'. NPIs are 10-digit strings; malformed
// entries are dropped on load.

export const WATCHLIST_STORAGE_KEY = 'providerlens.watchlist'
export const WATCHLIST_MAX = 200

const NPI_RE = /^\d{10}$/

export function isValidNpi(value) {
  return typeof value === 'string' && NPI_RE.test(value)
}

function emptyState() {
  return { version: 1, npis: [], addedAt: {} }
}

// Load and sanitize the stored shape. Anything unreadable or malformed falls
// back to an empty list rather than throwing.
export function loadWatchlist(storage = window.localStorage) {
  let raw
  try {
    raw = storage.getItem(WATCHLIST_STORAGE_KEY)
  } catch {
    return emptyState()
  }
  if (!raw) return emptyState()
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return emptyState()
  }
  if (!parsed || !Array.isArray(parsed.npis)) return emptyState()
  const state = emptyState()
  for (const npi of parsed.npis) {
    if (!isValidNpi(npi) || state.npis.includes(npi)) continue
    state.npis.push(npi)
    if (parsed.addedAt && typeof parsed.addedAt[npi] === 'string') {
      state.addedAt[npi] = parsed.addedAt[npi]
    }
  }
  return state
}

export function saveWatchlist(state, storage = window.localStorage) {
  try {
    storage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Quota or private-mode failure: the in-memory state still works.
  }
}

// Returns the next state, or null when the add is rejected (invalid NPI or
// the cap is reached).
export function addNpi(state, npi, now = new Date().toISOString()) {
  if (!isValidNpi(npi) || state.npis.includes(npi)) return null
  if (state.npis.length >= WATCHLIST_MAX) return null
  return {
    version: 1,
    npis: [...state.npis, npi],
    addedAt: { ...state.addedAt, [npi]: now },
  }
}

export function removeNpi(state, npi) {
  if (!state.npis.includes(npi)) return state
  const addedAt = { ...state.addedAt }
  delete addedAt[npi]
  return {
    version: 1,
    npis: state.npis.filter((n) => n !== npi),
    addedAt,
  }
}

// Merge a decoded list into the state. Returns { state, added, skipped },
// where skipped counts entries that were invalid or already present.
export function mergeNpis(state, npis, now = new Date().toISOString()) {
  let next = state
  let added = 0
  let skipped = 0
  for (const npi of npis) {
    const candidate = addNpi(next, npi, now)
    if (candidate) {
      next = candidate
      added += 1
    } else {
      skipped += 1
    }
  }
  return { state: next, added, skipped }
}

// --- Share token -----------------------------------------------------------
// Format: the JSON array of NPI strings, UTF-8 encoded, base64url (no padding,
// URL-safe alphabet). Example token decodes to ["1234567890"].

function bytesToBase64Url(bytes) {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBytes(token) {
  const b64 = token.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function encodeShareToken(npis) {
  const clean = npis.filter(isValidNpi)
  const json = JSON.stringify(clean)
  const bytes = new TextEncoder().encode(json)
  return bytesToBase64Url(bytes)
}

// Returns the NPI list, or null if the token is malformed or carries no
// valid NPIs.
export function decodeShareToken(token) {
  if (typeof token !== 'string' || token.length === 0) return null
  let parsed
  try {
    parsed = JSON.parse(new TextDecoder().decode(base64UrlToBytes(token)))
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null
  const npis = parsed.filter(isValidNpi)
  return npis.length > 0 ? npis : null
}
