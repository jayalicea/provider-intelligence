# Method Statement: Provider Exclusion Screening (Package B v1)

Effective date: 2026-09-12. This statement ships with every screening
deliverable produced by the Provider Intelligence Platform.

## Sources used

- **OIG LEIE (List of Excluded Individuals and Entities)**, monthly
  downloadable file `UPDATED.csv`, published by the U.S. Department of
  Health and Human Services Office of Inspector General. Local snapshot:
  84,001 rows loaded 2026-09-12; every value carries `source` (UPDATED.csv)
  and `as_of` (2026-09-12) provenance.
- **NPI Registry (NIH Clinical Tables)**, used only for provider identity
  (name, credential, taxonomy, practice address). Identity values come from
  the platform's local cache of NPI Registry responses; each carries its
  source and the cache row's sync date.

## Match logic

1. **NPI exact match first.** When the roster supplies a syntactically valid
   NPI (10 digits, not the LEIE no-NPI sentinel), the snapshot is queried by
   NPI. An active row (no reinstatement date) yields EXCLUDED. A matched row
   with a reinstatement date yields CLEAR with the reinstatement details
   reported.
2. **Name plus state fallback.** Only when no valid NPI is available, the
   lastname, firstname, and state are normalized (uppercased, trimmed,
   whitespace collapsed, punctuation stripped) and matched against the
   snapshot. An active match yields EXCLUDED.
3. **Reinstated records are excluded from active matches.** A row with a
   reinstatement date never produces an EXCLUDED verdict.
4. **Prefer a miss over a false clear.** CLEAR is returned only when a
   definitive non-match was established (the NPI or the name plus state was
   checked and no record exists). When neither a valid NPI nor a usable
   name plus state is supplied, or the database query fails, the verdict is
   UNVERIFIED. An exception can never produce CLEAR.

## Verdicts

- **EXCLUDED**: an active exclusion record matched by NPI, or by normalized
  name plus state.
- **CLEAR**: the supplied identity was checked against the snapshot and no
  active record exists. A prior exclusion that has been reinstated is
  reported as CLEAR with the reinstatement date shown.
- **UNVERIFIED**: the check could not be completed (no usable identity, or a
  query failure). UNVERIFIED is not a clearance and must not be treated as
  one.

## Known limitations

- The LEIE snapshot carries **dates of birth as YYYYMMDD text for about
  79,683 records**. When the roster supplies a DOB, it is canonicalized
  (non-digits stripped; an MMDDYYYY-looking value is flipped to YYYYMMDD)
  and compared against the candidate record. An exact match confirms the
  name plus state match (`dobStatus: confirmed`). A mismatch downgrades the
  verdict to UNVERIFIED: the candidate stays reported for manual review, but
  an EXCLUDED verdict would overstate a name match whose DOB disagrees. When
  the record carries no DOB, the match proceeds on name plus state alone
  (`dobStatus: unavailable`). When the roster supplies no DOB, behavior is
  unchanged (`dobStatus: not_provided`). Name matches without a DOB check
  can still coincide with a different individual sharing the same name and
  state; NPI matches do not have this weakness.
- **CLEAR means "no record in these sources as of the as-of date."** It is
  not a certification that a provider has never been, or will never be,
  excluded.
- **Stale-source risk.** The snapshot is refreshed on a scheduled cycle; a
  provider excluded between refreshes will not appear until the next load.
  Every output field carries its as-of date so recipients can judge
  freshness.
- The NPI Registry identity cache can lag the registry itself; identity
  fields carry the cache sync date.

## FCRA positioning

Screening outputs are diligence aids compiled from public sources. They are
not legal advice and are not consumer reports. Screening used for
credentialing, employment, or other eligibility decisions may implicate the
Fair Credit Reporting Act and state screening laws; applicability must be
confirmed before the outputs are sold into those use cases. Until then the
default positioning is quality-assurance and outreach screening only, public
data only, with no Business Associate Agreement triggered. Recipients remain
responsible for any decision taken on the basis of these reports.

## Required notice

Every report includes, verbatim:

> This report states what public sources published as of the dates shown. It
> does not certify any provider's status.
