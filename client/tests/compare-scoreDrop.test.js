import { describe, it, expect } from 'vitest'
import { loadCompareList, addToCompare, removeFromCompare } from '../src/lib/compare.js'
import { findLargestDrop } from '../src/lib/scoreDrop.js'

function mockStorage() {
  const data = new Map()
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
  }
}

describe('compare lib', () => {
  it('loads an empty list for missing or malformed storage', () => {
    expect(loadCompareList(mockStorage())).toEqual([])
    const bad = mockStorage()
    bad.setItem('providerlens.compare', '{oops')
    expect(loadCompareList(bad)).toEqual([])
  })

  it('adds up to the cap and rejects duplicates/invalid NPIs', () => {
    let list = []
    list = addToCompare(list, '1111111111')
    list = addToCompare(list, '2222222222')
    list = addToCompare(list, '3333333333')
    expect(list).toHaveLength(3)
    expect(addToCompare(list, '4444444444')).toBeNull()
    expect(addToCompare(list, '1111111111')).toBeNull()
    expect(addToCompare(list, 'nope')).toBeNull()
  })

  it('drops malformed entries on load and caps at 3', () => {
    const storage = mockStorage()
    storage.setItem('providerlens.compare', JSON.stringify(['1111111111', 'bad', '2222222222', '3333333333', '4444444444']))
    expect(loadCompareList(storage)).toEqual(['1111111111', '2222222222', '3333333333'])
  })

  it('removeFromCompare filters by NPI', () => {
    expect(removeFromCompare(['1111111111', '2222222222'], '1111111111')).toEqual(['2222222222'])
  })
})

describe('scoreDrop lib', () => {
  it('finds the largest consecutive-year drop', () => {
    const years = [
      { year: 2021, finalScore: 90 },
      { year: 2022, finalScore: 70 },
      { year: 2023, finalScore: 75 },
    ]
    expect(findLargestDrop(years)).toEqual({ fromYear: 2021, toYear: 2022, drop: 20 })
  })

  it('ignores rises and returns null for fewer than two years', () => {
    expect(findLargestDrop([{ year: 2021, finalScore: 50 }])).toBeNull()
    const rising = [
      { year: 2021, finalScore: 60 },
      { year: 2022, finalScore: 80 },
    ]
    expect(findLargestDrop(rising)).toBeNull()
  })
})
