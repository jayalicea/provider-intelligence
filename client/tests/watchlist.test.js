import { describe, it, expect } from 'vitest'
import {
  WATCHLIST_MAX,
  isValidNpi,
  loadWatchlist,
  saveWatchlist,
  addNpi,
  removeNpi,
  mergeNpis,
  encodeShareToken,
  decodeShareToken,
} from '../src/lib/watchlist.js'

function mockStorage() {
  const data = new Map()
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  }
}

describe('watchlist lib', () => {
  it('validates 10-digit NPIs only', () => {
    expect(isValidNpi('1234567890')).toBe(true)
    expect(isValidNpi('123456789')).toBe(false)
    expect(isValidNpi('abcdefghij')).toBe(false)
    expect(isValidNpi(1234567890)).toBe(false)
  })

  it('round-trips through save/load', () => {
    const storage = mockStorage()
    const added = addNpi(loadWatchlist(storage), '1234567890')
    saveWatchlist(added, storage)
    const loaded = loadWatchlist(storage)
    expect(loaded.npis).toEqual(['1234567890'])
    expect(loaded.alert.enabled).toBe(false)
  })

  it('migrates v1 payloads and drops malformed NPIs', () => {
    const storage = mockStorage()
    storage.setItem('providerlens.watchlist', JSON.stringify({
      version: 1,
      npis: ['1234567890', 'bad', '9999999999'],
      addedAt: { 1234567890: '2026-09-01' },
    }))
    const loaded = loadWatchlist(storage)
    expect(loaded.npis).toEqual(['1234567890', '9999999999'])
    expect(loaded.addedAt['1234567890']).toBe('2026-09-01')
    expect(loaded.alert.dropThreshold).toBe(10)
  })

  it('rejects duplicates, invalid NPIs, and entries past the cap', () => {
    let state = loadWatchlist(mockStorage())
    expect(addNpi(state, 'bad')).toBeNull()
    state = addNpi(state, '1234567890')
    expect(addNpi(state, '1234567890')).toBeNull()
    for (let i = 0; i < WATCHLIST_MAX; i++) {
      const next = addNpi(state, String(2000000000 + i))
      if (!next) break
      state = next
    }
    expect(addNpi(state, '9876543210')).toBeNull()
  })

  it('removeNpi drops the NPI and its addedAt entry', () => {
    let state = addNpi(loadWatchlist(mockStorage()), '1234567890')
    state = removeNpi(state, '1234567890')
    expect(state.npis).toEqual([])
    expect(state.addedAt['1234567890']).toBeUndefined()
  })

  it('mergeNpis counts added vs skipped', () => {
    let state = addNpi(loadWatchlist(mockStorage()), '1234567890')
    const { state: next, added, skipped } = mergeNpis(state, ['1234567890', '9999999999', 'x'])
    expect(added).toBe(1)
    expect(skipped).toBe(2)
    expect(next.npis).toHaveLength(2)
  })

  it('share tokens round-trip NPIs and alerts', () => {
    const token = encodeShareToken(['1234567890'], { enabled: true, dropThreshold: 15 })
    const decoded = decodeShareToken(token)
    expect(decoded.npis).toEqual(['1234567890'])
    expect(decoded.alert).toEqual({ enabled: true, dropThreshold: 15 })
  })

  it('decodeShareToken rejects malformed tokens', () => {
    expect(decodeShareToken('')).toBeNull()
    expect(decodeShareToken('not-base64!!!')).toBeNull()
    expect(decodeShareToken(encodeShareToken([]))).toBeNull()
  })
})
