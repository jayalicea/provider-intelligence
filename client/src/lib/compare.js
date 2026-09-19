// Side-by-side comparison list: a small (2-3) set of NPIs persisted in
// localStorage, separate from the watchlist. Shape is the plain JSON array
// of NPI strings (max 3), not the watchlist's object envelope.
// Storage key: 'providerlens.compare'. Same 10-digit NPI validation as the
// watchlist module; malformed entries are dropped on load.

import { isValidNpi } from './watchlist.js'

export const COMPARE_STORAGE_KEY = 'providerlens.compare'
export const COMPARE_MAX = 3

export function loadCompareList(storage = window.localStorage) {
  let raw
  try {
    raw = storage.getItem(COMPARE_STORAGE_KEY)
  } catch {
    return []
  }
  if (!raw) return []
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const list = []
  for (const npi of parsed) {
    if (!isValidNpi(npi) || list.includes(npi)) continue
    if (list.length >= COMPARE_MAX) break
    list.push(npi)
  }
  return list
}

export function saveCompareList(npis, storage = window.localStorage) {
  try {
    storage.setItem(COMPARE_STORAGE_KEY, JSON.stringify(npis))
  } catch {
    // Quota or private-mode failure: the in-memory list still works.
  }
}

// Returns the next list, or null when the add is rejected (invalid NPI,
// duplicate, or the cap is reached).
export function addToCompare(list, npi) {
  if (!isValidNpi(npi) || list.includes(npi)) return null
  if (list.length >= COMPARE_MAX) return null
  return [...list, npi]
}

export function removeFromCompare(list, npi) {
  return list.filter((n) => n !== npi)
}
