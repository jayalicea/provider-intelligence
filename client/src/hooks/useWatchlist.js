import { useCallback, useMemo, useState } from 'react'
import {
  WATCHLIST_MAX,
  addNpi,
  loadWatchlist,
  mergeNpis,
  removeNpi,
  saveWatchlist,
} from '../lib/watchlist.js'

/**
 * React wrapper around the localStorage watchlist. Exposes the list plus
 * has/add/remove/toggle and merge (for share links). `capMessage` is set when
 * an add is rejected because the list is full; clear it with clearMessage().
 */
export function useWatchlist() {
  const [state, setState] = useState(() => loadWatchlist())
  const [capMessage, setCapMessage] = useState(null)

  const commit = useCallback((next) => {
    setState(next)
    saveWatchlist(next)
  }, [])

  const has = useCallback((npi) => state.npis.includes(npi), [state])

  const add = useCallback(
    (npi) => {
      const next = addNpi(state, npi)
      if (!next) {
        if (state.npis.length >= WATCHLIST_MAX && !state.npis.includes(npi)) {
          setCapMessage(
            `Watchlist is full at ${WATCHLIST_MAX} providers. Remove one before adding more.`
          )
        }
        return false
      }
      commit(next)
      return true
    },
    [state, commit]
  )

  const remove = useCallback(
    (npi) => {
      commit(removeNpi(state, npi))
    },
    [state, commit]
  )

  const toggle = useCallback(
    (npi) => {
      if (state.npis.includes(npi)) {
        remove(npi)
        return false
      }
      return add(npi)
    },
    [state, add, remove]
  )

  const merge = useCallback(
    (npis) => {
      const result = mergeNpis(state, npis)
      if (result.added > 0) commit(result.state)
      return result
    },
    [state, commit]
  )

  return useMemo(
    () => ({
      npis: state.npis,
      addedAt: state.addedAt,
      count: state.npis.length,
      max: WATCHLIST_MAX,
      has,
      add,
      remove,
      toggle,
      merge,
      capMessage,
      clearCapMessage: () => setCapMessage(null),
    }),
    [state, has, add, remove, toggle, merge, capMessage]
  )
}
