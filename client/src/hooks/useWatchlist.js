import { useCallback, useMemo, useState } from 'react'
import {
  WATCHLIST_MAX,
  addNpi,
  loadWatchlist,
  mergeNpis,
  removeNpi,
  saveWatchlist,
  setAlertConfig,
  isValidAlert,
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

  const setAlert = useCallback(
    (alert) => {
      commit(setAlertConfig(state, alert))
    },
    [state, commit]
  )

  const merge = useCallback(
    (npis) => {
      const result = mergeNpis(state, npis)
      if (result.added > 0) commit(result.state)
      return result
    },
    [state, commit]
  )

  // Share-link load: merge NPIs and apply the shared alert config (when the
  // token carries one) in a single commit so neither update clobbers the
  // other. Returns { added, skipped, alertApplied }.
  const mergeShared = useCallback(
    (npis, alert) => {
      const result = mergeNpis(state, npis)
      let next = result.state
      let alertApplied = false
      if (isValidAlert(alert)) {
        next = setAlertConfig(next, alert)
        alertApplied = true
      }
      if (result.added > 0 || alertApplied) commit(next)
      return { ...result, alertApplied }
    },
    [state, commit]
  )

  return useMemo(
    () => ({
      npis: state.npis,
      addedAt: state.addedAt,
      alert: state.alert,
      count: state.npis.length,
      max: WATCHLIST_MAX,
      has,
      add,
      remove,
      toggle,
      setAlert,
      merge,
      mergeShared,
      capMessage,
      clearCapMessage: () => setCapMessage(null),
    }),
    [state, has, add, remove, toggle, setAlert, merge, mergeShared, capMessage]
  )
}
