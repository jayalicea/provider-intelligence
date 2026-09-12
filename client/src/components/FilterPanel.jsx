const STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
]

export default function FilterPanel({ state, city, taxonomy, onChange }) {
  const update = (patch) => onChange({ state, city, taxonomy, ...patch })

  return (
    <div className="filter-panel">
      <label className="field">
        <span className="field-label">State</span>
        <select
          className="input"
          value={state}
          onChange={(e) => update({ state: e.target.value })}
        >
          <option value="">All states</option>
          {STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span className="field-label">City</span>
        <input
          type="text"
          className="input"
          value={city}
          placeholder="City"
          onChange={(e) => update({ city: e.target.value })}
          onBlur={(e) => update({ city: e.target.value.trim() })}
        />
      </label>

      <label className="field">
        <span className="field-label">Taxonomy</span>
        <input
          type="text"
          className="input"
          value={taxonomy}
          placeholder="e.g. 207R00000X"
          onChange={(e) => update({ taxonomy: e.target.value })}
          onBlur={(e) => update({ taxonomy: e.target.value.trim() })}
        />
      </label>
    </div>
  )
}
