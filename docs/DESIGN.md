# DESIGN.md: Client-Facing Dashboard Design and Copy Deck

Everything in this file is normative for the frontend build (Prompt A, Phase 3).
Where docs/FRONTEND_SPEC.md and this file conflict on visual matters, this file wins.
The live backend response shapes remain the only authority on data.

## 1. Brand frame

Working product name: ProviderLens (placeholder, easy to change later).
Tone: clinical, calm, precise. The product's credibility comes from showing provenance,
not from visual drama. No gradients on data surfaces, no rounded-corner KPI theatrics,
no emojis anywhere in the UI.

## 2. Design tokens

Colors (CSS custom properties):
  --bg:            #F7F9FA   (page background)
  --surface:       #FFFFFF   (cards, tables)
  --border:        #DCE3E8   (hairlines)
  --text:          #1C2B33   (primary)
  --text-muted:    #5B6B75   (secondary, metadata)
  --accent:        #0F6B5C   (teal, primary actions and primary series)
  --accent-hover:  #0A5448
  --good:          #2E7D32   (above national, positive)
  --warn:          #B26A00   (caution, footnote-coded values)
  --bad:           #C62828   (below national, flags)
  --unscored:      #8A9AA5   (null values, never red)

Typography: system stack (Segoe UI, Helvetica Neue, Arial). Base 14px, line-height 1.45.
H1 22px 600, H2 17px 600, table header 12px uppercase letterspaced text-muted.
Numbers in tables: tabular-nums. Monospace for NPIs and dates: Consolas, monospace 13px.

Spacing: 8px grid. Card padding 16px, page gutter 24px, section gap 24px.
Radius: 4px on cards and inputs only.

## 3. Provenance rule (the design centerpiece)

Every value that comes from a government source renders with its as-of context.
Pattern: value + small muted line under it: "CMS QPP Experience, accessed 2026-09-12".
Where the API returns null with a footnote reason, render the gray "Not reported"
plus the footnote reason as a tooltip, never a dash or a zero.

## 4. Page copy deck

Global header: "ProviderLens" left; right side: environment tag "Public data only" and
a link "About this data" opening the disclaimer panel (section 7).

Search page:
  H1: Find a provider
  Sub: Search the NPI Registry, MIPS quality scores, and hospital quality measures.
  Placeholders: Name "Dr. Smith or 1234567890", City, State (select), Taxonomy "e.g. Internal Medicine"
  Empty state: "Start with a name, an NPI number, or a state. Results come from the public NPI Registry."
  No results: "No providers matched. The NPI Registry only lists active registrations; try broadening the state filter."

Provider detail:
  H1: provider full name + credential. Under it: NPI (mono), taxonomy, practice address, phone.
  Tabs: Overview | MIPS Performance | Quality Measures
  Overview copy: identity fields with provenance sublines.

MIPS dashboard tab:
  H1: MIPS performance
  If scored: overall final score as a big number with year; four category bars.
  If unscored: gray card "No MIPS score reported for {year}" plus the reason from the API.
  Trends chart: multi-year lines. A persistent info banner above it reads:
  "Year labels are request vintages on CMS's rolling dataset. Year-over-year movement may
  reflect re-based scores, not true performance change." (API warning field, when present.)

Quality measures tab:
  H1: Hospital quality measures
  Table columns: Measure | Score | National comparison | As of
  Compared-to-national badge text exactly: "Better than national" (green),
  "Same as national" (neutral), "Worse than national" (red), "Not reported" (gray).
  Footnote-coded scores render "Not reported" with the reason in a tooltip.

Loading: skeleton rows, 3 per table, never spinners on data surfaces.
Errors: "This source did not respond. Cached data, if any, is shown with its access date."
API returns null: always render the gray unscored state, never invent a value.

## 5. Accessibility

Contrast AA minimum everywhere including the muted provenance text.
All color encodings also carry text (badges have words, not color alone).
Keyboard: search filters are a form; Enter submits. Focus rings visible.
Charts (recharts): include a data table fallback toggle for screen readers.

## 6. Empty and partial-data honesty

The single most important UX rule: the UI never looks more certain than the data.
Partial datasets render with row counts ("Showing 2 of 9 states cached" style notes
where the API provides counts) and the unscored gray state is a first-class citizen,
not an error.

## 7. Disclaimer panel ("About this data")

Fixed text, verbatim:
"ProviderLens reports what public US government sources publish, as of the access date
shown with each value. Sources: NIH NPI Registry, CMS Quality Payment Program Experience,
CMS Care Compare. Scores are as published by CMS, including risk adjustment applied by CMS.
This tool is not medical advice, is not a credentialing decision, and certifies nothing.
Values may be stale or incorrect at the source; always verify against the source directly."

## 8. What this file does not cover

Component props, endpoint shapes, state management: FRONTEND_SPEC.md and the live
backend remain authoritative. This file governs look, voice, and honesty behavior only.
