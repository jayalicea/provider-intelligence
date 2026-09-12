# Provider Intelligence Platform: Frontend Specification

A minimal React frontend blueprint for the Provider Intelligence Platform. The backend is Node.js/Express + PostgreSQL and is already live. This document covers routes, pages, components, API contracts, state handling, and visual style.

## 1. Overview and Stack

- React 18+ with TypeScript
- react-router-dom v6 for routing
- TanStack Query (React Query) for server state (recommended, see Section 7)
- recharts for charts
- Plain CSS modules or a small utility layer; no UI framework required
- Backend base URL is configurable, e.g. `http://localhost:3000/api`, provided via environment variable `VITE_API_BASE_URL`

## 2. API Surface (Backend Endpoints)

All endpoints are relative to the configured base URL. Response shapes marked **UNVERIFIED** are assumed from standard patterns and must be confirmed against the live backend before implementation is considered final.

| Method | Path | Purpose | Shape Status |
|---|---|---|---|
| GET | `/providers/search?query=&state=&city=&taxonomy=&page=&limit=` | Provider search with filters and pagination | UNVERIFIED |
| GET | `/providers/:npi` | Provider detail profile | UNVERIFIED |
| GET | `/providers/:npi/mips-performance` | Latest-year MIPS data (CMS QPP Experience dataset) | UNVERIFIED |
| GET | `/providers/:npi/mips-trends` | Multi-year MIPS trend records | UNVERIFIED |
| GET | `/quality-measures/:facilityId` | Care Compare quality measure rows | UNVERIFIED |
| POST | `/providers/bulk-data` | Bulk export/ingest | UNVERIFIED |

### Expected Response Shapes

Provider search response (**UNVERIFIED**, confirm against live backend):

```ts
interface ProviderSearchResponse {
  results: ProviderSearchResult[];
  total: number;
  page: number;
  limit: number;
}

interface ProviderSearchResult {
  npi: string;
  firstName: string | null;
  lastName: string | null;
  organizationName: string | null;
  taxonomyDescription: string | null;
  city: string | null;
  state: string | null;
}
```

Provider detail (**UNVERIFIED**):

```ts
interface ProviderDetail {
  npi: string;
  firstName: string | null;
  lastName: string | null;
  organizationName: string | null;
  taxonomyDescription: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city: string | null;
  state: string | null;
  zip?: string | null;
  phone?: string | null;
}
```

Latest-year MIPS performance (**UNVERIFIED**; upstream QPP Experience dataset columns are lowercase with spaces, backend is assumed to normalize to camelCase):

```ts
interface MipsPerformance {
  npi: string;
  year: number;
  finalScore: number | null;
  qualityScore: number | null;
  piScore: number | null;          // Promoting Interoperability
  iaScore: number | null;          // Improvement Activities
  costScore: number | null;
  paymentAdjustmentPct: number | null;
}
```

MIPS trends (**UNVERIFIED**):

```ts
interface MipsTrendRecord {
  year: number;
  finalScore: number | null;
  qualityScore: number | null;
  piScore: number | null;
  iaScore: number | null;
  costScore: number | null;
  paymentAdjustmentPct: number | null;
}

type MipsTrendsResponse = MipsTrendRecord[];
```

Care Compare quality measures (**UNVERIFIED**):

```ts
interface QualityMeasure {
  facilityId: string;
  facilityName: string;
  measureId: string;
  measureName: string;
  score: string | null;              // string to safely hold percents, ratios, and star ratings
  comparedToNational: string | null; // null or absent for HCAHPS family rows
  footnote: string | null;           // numeric CMS Footnote Crosswalk code as string
  startDate: string | null;
  endDate: string | null;
}

type QualityMeasuresResponse = QualityMeasure[];
```

Notes on quality measures:

- `comparedToNational` values come from CMS, e.g. `"No Different Than the National Rate"`, `"Better Than the National Rate"`, `"Worse Than the National Rate"`.
- HCAHPS family rows have no `comparedToNational`; they carry star ratings and answer percents instead. The table must render a neutral fallback in that column for these rows.
- Footnote codes are numeric strings from the CMS Footnote Crosswalk, e.g. `1` = too few cases to report, `2` = based on a sample, `3` = shorter time period than required. Unknown codes should display the raw code with a generic label.

## 3. Route Table

| Path | Page Component | Data Dependencies |
|---|---|---|
| `/` | redirect to `/providers` | none |
| `/providers` | `ProviderSearchPage` | GET `/providers/search` |
| `/providers/:npi` | `ProviderDetailPage` | GET `/providers/:npi`, GET `/providers/:npi/mips-performance` |
| `/providers/:npi/mips` | `MipsDashboard` | GET `/providers/:npi/mips-performance`, GET `/providers/:npi/mips-trends` |
| `/facilities/:facilityId/quality` | `HospitalQualityPage` | GET `/quality-measures/:facilityId` |
| `*` | `NotFoundPage` | none |

## 4. Pages and Components

For each component: props interface, the exact endpoint it calls, expected response shape, and loading/error/empty behavior. Leaf presentational components do not call APIs themselves; data fetching lives in page-level containers or dedicated hooks.

### 4.1 ProviderSearchPage

Route: `/providers`. Owns search state (query, filters, page) and calls `GET /providers/search` via React Query. Filter and query changes reset `page` to 1. State is mirrored into URL search params so results are shareable.

#### SearchBar

```ts
interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
}
```

- API: none directly; parent calls `GET /providers/search?query=...`.
- Behavior: debounce input (300 ms) or submit on Enter/button click. Disabled while parent is loading is optional, not required.

#### FilterPanel

```ts
interface FilterPanelProps {
  state: string;
  city: string;
  taxonomy: string;
  onChange: (filters: { state: string; city: string; taxonomy: string }) => void;
}
```

- API: none directly; values feed `state`, `city`, `taxonomy` query params of `GET /providers/search`.
- Behavior: controlled inputs; `onChange` fires on blur or explicit Apply; changing any filter resets pagination.

#### ProviderResultsTable

```ts
interface ProviderResultsTableProps {
  results: ProviderSearchResult[];
  loading: boolean;
  error: string | null;
  page: number;
  total: number;
  limit: number;
  onPageChange: (page: number) => void;
}
```

- API: parent calls `GET /providers/search` with `query`, `state`, `city`, `taxonomy`, `page`, `limit`; expected response `ProviderSearchResponse` (**UNVERIFIED**).
- Columns: NPI, Name (individual name or organization name fallback), Taxonomy, City, State. NPI cell links to `/providers/:npi`.
- Loading: `LoadingSpinner` centered in the table region; keep previous results visible under a dimmed overlay if using React Query `keepPreviousData`.
- Error: `ErrorBanner` above the table with retry button re-invoking the query.
- Empty: `EmptyState` with message "No providers match the current search." and a hint to broaden filters.
- Pagination: previous/next plus "Page X of Y" derived from `total` and `limit`; disable controls at boundaries.

### 4.2 ProviderDetailPage

Route: `/providers/:npi`. Fetches provider detail and latest MIPS performance in parallel (two React Query keys). Renders `ProviderProfileCard`, `MipsSummaryCard`, and a link to `/providers/:npi/mips`.

#### ProviderProfileCard

```ts
interface ProviderProfileCardProps {
  provider: ProviderDetail;
  loading: boolean;
  error: string | null;
}
```

- API: parent calls `GET /providers/:npi`; expected response `ProviderDetail` (**UNVERIFIED**).
- Content: full name or organization, NPI, taxonomy description, mailing/practice address, phone if present.
- Loading: skeleton block or `LoadingSpinner` inside the card.
- Error: `ErrorBanner`; if the provider is not found (404), render `EmptyState` with "Provider not found."
- Empty: not applicable for a single record; missing fields render as an em-dash-free placeholder, use the text "Not available".

#### MipsSummaryCard

```ts
interface MipsSummaryCardProps {
  performance: MipsPerformance | null;
  loading: boolean;
  error: string | null;
}
```

- API: parent calls `GET /providers/:npi/mips-performance`; expected response `MipsPerformance` (**UNVERIFIED**; assumes backend normalizes QPP Experience columns to camelCase).
- Content: reporting year, final score (large), payment adjustment percentage, and the four category scores (Quality, PI, IA, Cost) as labeled values or a compact bar list.
- Loading: `LoadingSpinner`.
- Error: `ErrorBanner` scoped to the card so the profile card still renders.
- Empty: if `performance` is null or all scores are null, render `EmptyState` with "No MIPS performance data available for this provider."

### 4.3 MipsDashboard

Route: `/providers/:npi/mips`. Fetches latest performance and multi-year trends.

#### CategoryBarChart

```ts
interface CategoryBarChartProps {
  scores: {
    quality: number | null;
    pi: number | null;
    ia: number | null;
    cost: number | null;
  };
  year: number;
}
```

- API: parent calls `GET /providers/:npi/mips-performance`; expected response `MipsPerformance` (**UNVERIFIED**).
- Rendering: recharts `BarChart` with four bars labeled Quality, Promoting Interoperability, Improvement Activities, Cost. Null scores render as zero-height bars with a "Not available" annotation, or are omitted with a legend note. Chart title includes `year`.
- Colors: use the primary slate blue for bars; no gradients.
- Empty: if all scores are null, render `EmptyState` instead of the chart.

#### ScoreTrendChart

```ts
interface ScoreTrendChartProps {
  trends: MipsTrendRecord[];
}
```

- API: parent calls `GET /providers/:npi/mips-trends`; expected response `MipsTrendsResponse` (**UNVERIFIED**).
- Rendering: recharts `LineChart` with `year` on the x-axis and `finalScore` on the y-axis; one line for final score. Optionally add dashed lines for category scores behind a toggle, but the minimum requirement is the final score trend. Sort ascending by year before rendering.
- Loading: `LoadingSpinner` in the chart container.
- Error: `ErrorBanner` with retry.
- Empty: if `trends` is empty, render `EmptyState` with "No multi-year MIPS trend data available." A single data point renders as a point with a note that only one year is available.

### 4.4 HospitalQualityPage

Route: `/facilities/:facilityId/quality`. Fetches quality measures and renders the table. Facility name shown in the page heading, taken from the first row's `facilityName`.

#### QualityMeasuresTable

```ts
interface QualityMeasuresTableProps {
  facilityId: string;
  measures: QualityMeasure[];
  loading: boolean;
  error: string | null;
}
```

- API: parent calls `GET /quality-measures/:facilityId`; expected response `QualityMeasuresResponse` (**UNVERIFIED**).
- Columns: Measure ID, Measure Name, Score, National Comparison, Footnote, Period (`startDate` to `endDate`, formatted as `MM/YYYY`).
- National Comparison column renders `NationalComparisonBadge`.
- Footnote column renders the numeric code with a tooltip or inline label resolved from the CMS Footnote Crosswalk (at minimum: `1` too few cases to report, `2` based on a sample, `3` shorter time period than required). Unknown codes render the raw code with the label "See CMS Footnote Crosswalk".
- Grouping option: group rows by measure family (detect HCAHPS rows by `measureId` prefix `H_` or by the absence of `comparedToNational`) so HCAHPS star-rating rows display their neutral badge consistently.
- Loading: `LoadingSpinner`.
- Error: `ErrorBanner` with retry.
- Empty: `EmptyState` with "No quality measures reported for this facility."

#### NationalComparisonBadge

```ts
interface NationalComparisonBadgeProps {
  comparedToNational: string | null;
}
```

- API: none (pure presentational).
- Mapping (case-insensitive contains match):
  - contains "Better" -> success badge, muted green, text "Better than national"
  - contains "No Different" -> neutral badge, gray, text "No different than national"
  - contains "Worse" -> error badge, muted red, text "Worse than national"
  - null/undefined/unrecognized (including all HCAHPS star-rating rows) -> neutral fallback badge, text "Not compared" or the raw value if present
- Accessibility: badge uses both color and text; never color alone. Use `role="status"` or plain text inside a `<span>` with sufficient contrast.

### 4.5 Shared Components and Modules

#### LoadingSpinner

```ts
interface LoadingSpinnerProps {
  label?: string; // default "Loading"
  size?: 'sm' | 'md' | 'lg';
}
```

Accessible spinner: `role="status"`, `aria-live="polite"`, visually hidden text label.

#### ErrorBanner

```ts
interface ErrorBannerProps {
  message: string;
  onRetry?: () => void;
}
```

Renders `role="alert"`, error color text and border, optional Retry button.

#### EmptyState

```ts
interface EmptyStateProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
}
```

Centered, muted text, optional action slot (e.g. "Clear filters").

#### ApiClient module

`src/api/client.ts`: a thin fetch wrapper.

```ts
interface ApiClientConfig {
  baseUrl: string; // from VITE_API_BASE_URL
}

interface ApiError {
  status: number;
  message: string;
  details?: unknown;
}

// Behavior:
// - prepends baseUrl to all paths
// - sets Accept: application/json
// - parses JSON when present, otherwise returns null
// - non-2xx responses are normalized into ApiError with a
//   human-readable message (server message preferred, status text fallback)
// - network failures become ApiError { status: 0, message: 'Network error' }
```

Example endpoint helpers:

```ts
searchProviders(params: SearchParams): Promise<ProviderSearchResponse>  // GET /providers/search
getProvider(npi: string): Promise<ProviderDetail>                       // GET /providers/:npi
getMipsPerformance(npi: string): Promise<MipsPerformance>               // GET /providers/:npi/mips-performance
getMipsTrends(npi: string): Promise<MipsTrendRecord[]>                  // GET /providers/:npi/mips-trends
getQualityMeasures(facilityId: string): Promise<QualityMeasure[]>       // GET /quality-measures/:facilityId
postBulkData(payload: unknown): Promise<unknown>                        // POST /providers/bulk-data
```

## 5. State Management Note

Recommendation: use TanStack Query (React Query) for all server state, with plain component state for UI-only concerns (form inputs, toggles).

Rationale:

- Search results, provider details, MIPS data, and quality measures are all server state: caching, deduplication, background refetch, and `keepPreviousData` for pagination come free.
- Loading and error states map directly to `isLoading` / `isError`, which aligns with the shared `LoadingSpinner` and `ErrorBanner` components.
- Plain fetch hooks are a viable lighter alternative for this small surface, but each page would re-implement caching, cancellation, and retry. Given the paginated search and multi-endpoint detail pages, React Query is the better default.

Suggested query keys: `['providers', 'search', params]`, `['providers', npi]`, `['providers', npi, 'mips-performance']`, `['providers', npi, 'mips-trends']`, `['quality-measures', facilityId]`.

The bulk endpoint (`POST /providers/bulk-data`) is a mutation, not a query; if an admin UI is added later, use a React Query mutation with optimistic-free, explicit success/error feedback. It has no page in this blueprint.

## 6. Visual Style

Restrained, clinical. No gradients. No saturated backgrounds. Generous whitespace, 1px borders, 6-8px corner radius on cards and inputs.

### Palette

| Token | Hex | Usage |
|---|---|---|
| `bg` | `#F7F8FA` | Page background |
| `surface` | `#FFFFFF` | Cards, tables, panels |
| `primary` | `#3B5B7E` | Links, primary buttons, chart bars (desaturated slate blue; similar tones acceptable) |
| `text` | `#1F2933` | Primary text |
| `textMuted` | `#52606D` | Secondary text, labels |
| `success` | `#4C8055` | "Better than national" badge, positive indicators |
| `warning` | `#B7791F` | Warnings, footnote highlights |
| `error` | `#B0433C` | Errors, "Worse than national" badge |
| `border` | `#E4E7EB` | Card and table borders, dividers |

Badge backgrounds use the base color at low opacity (e.g. 10-12% tint of success/error) with full-strength text color for contrast. Neutral badge uses `border` gray background with `textMuted` text.

### Typography

- Font stack: system stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`
- Base size: 14-16px (`1rem` = 16px, body copy at 14-16px)
- Headings: page titles 24px semibold, section titles 18px semibold, card titles 16px medium
- Line height: 1.5 for body, 1.25 for headings
- Tabular data: use `font-variant-numeric: tabular-nums` for score and NPI columns

## 7. Verification Checklist Before Build

1. Confirm `GET /providers/search` response envelope (`results`, `total`, `page`, `limit`) against the live backend. Currently UNVERIFIED.
2. Confirm provider detail field names, especially address fields. Currently UNVERIFIED.
3. Confirm MIPS endpoints return camelCase keys normalized from the QPP Experience dataset. Currently UNVERIFIED.
4. Confirm quality measure field names and the exact set of `comparedToNational` strings and footnote codes present in data. Currently UNVERIFIED.
5. Confirm the `POST /providers/bulk-data` request/response contract before building any admin UI for it. Currently UNVERIFIED.
