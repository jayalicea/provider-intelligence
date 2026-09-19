// User-curated provider watchlist: localStorage persistence plus a shareable
// URL token. No dependencies. Shape (version 2):
//   {
//     version: 2,
//     npis: string[],
//     addedAt: { [npi]: ISO date string },
//     alert: { enabled: boolean, dropThreshold: number },
//   }
// Version 1 ({ version: 1, npis, addedAt }) is migrated on load: alert
// defaults to off with a 10 point threshold.
// Storage key: 'providerlens.watchlist'. NPIs are 10-digit strings; malformed
// entries are dropped on load.

export const WATCHLIST_STORAGE_KEY = 'providerlens.watchlist'
export const WATCHLIST_MAX = 200
export const DEFAULT_DROP_THRESHOLD = 10

const NPI_RE = /^\d{10}$/

export function isValidNpi(value) {
  return typeof value === 'string' && NPI_RE.test(value)
}

export function isValidAlert(alert) {
  return (
    alert != null &&
    typeof alert === 'object' &&
    typeof alert.enabled === 'boolean' &&
    typeof alert.dropThreshold === 'number' &&
    Number.isFinite(alert.dropThreshold) &&
    alert.dropThreshold >= 1 &&
    alert.dropThreshold <= 100
  )
}

export function defaultAlert() {
  return { enabled: false, dropThreshold: DEFAULT_DROP_THRESHOLD }
}

function emptyState() {
  return { version: 2, npis: [], addedAt: {}, alert: defaultAlert() }
}

// Load and sanitize the stored shape, migrating v1 to v2. Anything unreadable
// or malformed falls back to an empty list rather than throwing.
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
  if (isValidAlert(parsed.alert)) {
    state.alert = {
      enabled: parsed.alert.enabled,
      dropThreshold: parsed.alert.dropThreshold,
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
    version: 2,
    npis: [...state.npis, npi],
    addedAt: { ...state.addedAt, [npi]: now },
    alert: { ...defaultAlert(), ...state.alert },
  }
}

export function removeNpi(state, npi) {
  if (!state.npis.includes(npi)) return state
  const addedAt = { ...state.addedAt }
  delete addedAt[npi]
  return {
    version: 2,
    npis: state.npis.filter((n) => n !== npi),
    addedAt,
    alert: { ...defaultAlert(), ...state.alert },
  }
}

// Update the alert config. Invalid values fall back to the defaults.
export function setAlertConfig(state, alert) {
  return {
    ...state,
    version: 2,
    alert: isValidAlert(alert) ? { enabled: alert.enabled, dropThreshold: alert.dropThreshold } : defaultAlert(),
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
// Formats, both UTF-8 encoded, base64url (no padding, URL-safe alphabet):
// - v1 (legacy): the JSON array of NPI strings, e.g. ["1234567890"].
// - v2: a JSON object { npis: string[], alert: { enabled, dropThreshold } }.
// decodeShareToken accepts both and always returns { npis, alert } (alert is
// null when the token carried none).

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

// Encodes a v2 token { npis, alert } when an alert config is given and
// enabled; otherwise the legacy bare-array format so old readers still work.
export function encodeShareToken(npis, alert = null) {
  const clean = npis.filter(isValidNpi)
  const payload =
    isValidAlert(alert) && alert.enabled
      ? { npis: clean, alert: { enabled: true, dropThreshold: alert.dropThreshold } }
      : clean
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  return bytesToBase64Url(bytes)
}

// Returns { npis, alert }, or null if the token is malformed or carries no
// valid NPIs. alert is null when the token had none (legacy bare array).
export function decodeShareToken(token) {
  if (typeof token !== 'string' || token.length === 0) return null
  let parsed
  try {
    parsed = JSON.parse(new TextDecoder().decode(base64UrlToBytes(token)))
  } catch {
    return null
  }
  if (Array.isArray(parsed)) {
    const npis = parsed.filter(isValidNpi)
    return npis.length > 0 ? { npis, alert: null } : null
  }
  if (parsed && Array.isArray(parsed.npis)) {
    const npis = parsed.npis.filter(isValidNpi)
    if (npis.length === 0) return null
    return {
      npis,
      alert: isValidAlert(parsed.alert)
        ? { enabled: parsed.alert.enabled, dropThreshold: parsed.alert.dropThreshold }
        : null,
    }
  }
  return null
}
