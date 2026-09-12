import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Minimal server-state hook: data/loading/error plus refetch.
 * `factory` must return a promise; only the latest call is applied.
 */
export function useFetch(factory, deps) {
  const [state, setState] = useState({ data: null, loading: true, error: null })
  const seq = useRef(0)

  const load = useCallback(async () => {
    const id = ++seq.current
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const data = await factory()
      if (id === seq.current) setState({ data, loading: false, error: null })
    } catch (error) {
      if (id === seq.current) setState({ data: null, loading: false, error })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/use-memo
  }, deps)

  useEffect(() => {
    load()
  }, [load])

  return { ...state, refetch: load }
}
