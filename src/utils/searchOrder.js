// For a name substring of 3+ characters the pg_trgm GIN index can find the
// matches, but with a plain ORDER BY <name> LIMIT the planner often walks the
// name b-tree in order instead and filters row by row, which is slow when
// matches cluster late in the alphabet (e.g. every "QUEST ..." lab):
// measured ~420 ms vs ~50 ms on 681k rows. Sorting on an expression the
// b-tree cannot supply steers it to the trigram bitmap scan plus a top-N
// sort. Shorter patterns cannot use trigrams, so they keep the b-tree plan.
function nameOrder(name, column) {
  return name && name.length >= 3 ? `(${column} || '')` : column;
}

module.exports = { nameOrder };
