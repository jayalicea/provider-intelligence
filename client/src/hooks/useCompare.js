import { useCallback, useMemo, useState } from 'react'
import {
  COMPARE_MAX,
  addToCompare,
  loadCompareList,
  removeFromCompare,
  saveCompareList,
} from '../lib/compare.js'

/**
 * React wrapper around the localStorage comparison list. Exposes the NPI
 * list plus has/add/remove. `message` is set when an add is rejected
 * (invalid, duplicate, or the list is full); clear it with clearMessage().
 */
export function useCompare() {
  const [npis, setNpis] = useState(() => loadCompareList())
  const [message, setMessage] = useState(null)

  const commit = useCallback((next) => {
    setNpis(next)
    saveCompareList(next)
  }, [])

  const has = useCallback((npi) => npis.includes(npi), [npis])

  const add = useCallback(
    (npi) => {
      const next = addToCompare(npis, npi)
      if (!next) {
        if (npis.includes(npi)) {
          setMessage(`NPI ${npi} is already on the comparison list.`)
        } else if (npis.length >= COMPARE_MAX) {
          setMessage(
            `The comparison list holds at most ${COMPARE_MAX} providers. Remove one before adding more.`
          )
        } else {
          setMessage('Enter a valid 10-digit NPI number.')
        }
        return false
      }
      commit(next)
      return true
    },
    [npis, commit]
  )

  const remove = useCallback(
    (npi) => {
      commit(removeFromCompare(npis, npi))
    },
    [npis, commit]
  )

  return useMemo(
    () => ({
      npis,
      count: npis.length,
      max: COMPARE_MAX,
      has,
      add,
      remove,
      message,
      clearMessage: () => setMessage(null),
    }),
    [npis, has, add, remove, message]
  )
}
