// In-flight request coalescing (single-flight). Concurrent callers sharing a
// key join one producer promise instead of each running their own upstream
// fetch. The entry is dropped when the producer settles, so a rejection never
// poisons the key and a later call re-invokes the producer.

const inFlight = new Map();

/**
 * Run `producer()` for `key`, or join the call already in flight for it.
 * Returns a promise that resolves/rejects with the shared producer result.
 */
function requestCoalesce(key, producer) {
  if (inFlight.has(key)) {
    return inFlight.get(key);
  }

  const promise = Promise.resolve()
    .then(producer)
    .finally(() => {
      if (inFlight.get(key) === promise) {
        inFlight.delete(key);
      }
    });

  inFlight.set(key, promise);
  return promise;
}

module.exports = { requestCoalesce };
