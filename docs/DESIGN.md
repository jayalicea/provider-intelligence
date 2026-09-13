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

These names are the ones in `client/src/index.css`. Change both together;
that file is the implementation of this section, not a separate opinion.

Colors (CSS custom properties):
  --bg:             #F5F7F6   (page background; warmed from the original
                               #F7F9FA so surfaces read as paper, not screen)
  --surface:        #FFFFFF   (cards, tables)
  --surface-sunken: #EEF2F1   (table headers, score tracks, skeleton fills)
  --surface-hover:  #F7FAF9   (row and control hover)
  --border:         #DCE3E8   (hairlines)
  --border-strong:  #C7D2D9   (input and control edges)
  --text:           #1C2B33   (primary)
  --text-muted:     #5B6B75   (secondary, metadata)
  --primary:        #0F6B5C   (teal, primary actions and primary series)
  --primary-hover:  #0A5448
  --primary-wash:   #EEF5F3   (tinted chip and banner backgrounds)
  --success:        #2E7D32   (above national, positive)  wash #EDF5ED
  --warning:        #B26A00   (caution, footnote-coded values)  wash #FBF3E6
  --error:          #C62828   (below national, flags)  wash #FBEEEE
  --unscored:       #8A9AA5   (null values, never red)  wash #F0F3F4

Elevation. Three levels, no more. Shadows are neutral-tinted, never black, and
never encode data:
  --elev-rest:    none                     (flat on the page)
  --elev-raised:  0 1px 1px rgba(28,43,51,.04), 0 2px 6px rgba(28,43,51,.05)
                                           (cards, tables, stat band, empty states)
  --elev-overlay: 0 2px 6px rgba(28,43,51,.08), 0 12px 32px rgba(28,43,51,.18)
                                           (modals only)

Spacing scale (8px grid with a 4px half-step). Use the token, not a literal:
  --space-1: 4px   --space-2: 8px   --space-3: 12px   --space-4: 16px
  --space-5: 24px  --space-6: 32px  --space-7: 48px
Page gutter --space-5, card padding --space-4/--space-5, section gap --space-6.

Radius: --radius 6px (cards, inputs, buttons, tables), --radius-sm 4px
(skeleton lines, focus ring corners), --radius-pill 999px (badges, score bars).

Motion: --transition 120ms cubic-bezier(.2,0,.2,1). Nothing over 150ms, and
nothing that delays information: transitions apply to colour and background,
never to layout or to the appearance of data. All motion is disabled under
prefers-reduced-motion.

Focus: --focus-ring is a 2px surface halo plus a 4px teal ring, applied through
:focus-visible on every interactive element. It must stay visible on white,
sunken and tinted surfaces alike. Never remove it without replacing it.

Typography: system stack (Segoe UI, Helvetica Neue, Arial). Base 14px, line-height 1.45.
H1 22px 600 (-0.01em), H2 17px 600, card title 16px 600.
Table headers and field labels: 11px 600 uppercase, 0.06em letterspacing, text-muted.
Numbers: tabular-nums everywhere they are compared. Monospace for NPIs and
dates: Consolas, monospace 13px.
Stat band value 26px 600; single KPI value 40px 600; both tabular-nums with the
label above in muted uppercase, never beside the number.

Layout: page container max-width 1140px, centred, with the header, main and
footer sharing that measure so the frame lines up.

Surfaces: no gradients on data surfaces, ever. Tables get sticky headers, row
hover, right-aligned numeric columns, and consistent 11px/24px cell padding.

## 3. Provenance rule (the design centerpiece)

Every value that comes from a government source renders with its as-of context.
Pattern: value + small muted line under it: "CMS QPP Experience, accessed 2026-09-12".
Where the API returns null with a footnote reason, render the gray "Not reported"
plus the footnote reason as a tooltip, never a dash or a zero.

## 4. Page copy deck

Global header: "ProviderLens" left, then primary nav: Search, Cohort, Watchlist,
Upload Roster, Coverage. The active route carries a teal underline rail plus
600 weight -- never colour alone. Right side: environment tag "Public data only"
and a link "About this data" opening the disclaimer panel (section 7).

Global footer: the data-sources line, and a platform as-of on the right reading
"Platform as of YYYY-MM-DD -- oldest source vintage". That date is the oldest
dataset vintage in the coverage registry, not the newest: the platform is only
as current as its stalest source.

Search landing: a stat band above the search form carrying the real platform
figures, read from client/src/data/coverage.json so the landing page and the
Coverage page cannot disagree. Each figure carries its source and vintage on
hover, per section 3. A caption under the band states the refresh cadence.

Upload roster:
  H1: Upload roster
  Sub: "Screen a roster against the federal LEIE and the state Medicaid
  exclusion lists. The file is read in your browser and only the parsed rows
  are sent; nothing is uploaded or stored."
  Header must contain npi, or lastname + firstname + state, or organizationname;
  dob optional. Results carry a verdict chip per row with the matching registry
  and its as-of.

Provider 360: two columns. Left rail is the identity card -- name, NPI,
verdict chip at --badge-lg, taxonomy, practice address, phone -- and it sticks
while the right column scrolls. Right column carries integrity, performance and
quality sections. Under 900px and in print the grid collapses to one column.

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

Badges and chips: one shape for every status. Tinted wash background, hairline
border in the same hue, pill radius, 12px 600 label, and a 6px status dot before
the label. The dot is decorative; the label always carries the meaning
(section 5). Sizes: default, and --badge-lg (13px) for the Provider 360 verdict.
Tones: success, error, warning, neutral, na (unscored), accent. Use badge-plain
to drop the dot where the chip is a label rather than a status.

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

## 8. Print

Provider 360 must still print as a clean one-page report. The print stylesheet
lives at the end of client/src/index.css and does three things: collapses the
dossier grid to a single column, removes every screen affordance (navigation,
footer, buttons, shadows, sticky positioning, hover surfaces, max-heights), and
makes badges survive greyscale by keeping the border and label while dropping
the tint. Cards and sections are break-inside: avoid. Provenance stays on the
page -- it is the point of the report.

## 9. What this file does not cover

Component props, endpoint shapes, state management: FRONTEND_SPEC.md and the live
backend remain authoritative. This file governs look, voice, and honesty behavior only.
