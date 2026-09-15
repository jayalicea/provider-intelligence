# Proof page screenshots

`../index.html` references three files in this directory by name:

| File | Shows |
|---|---|
| `screenshot-provider-detail.png` | Provider detail, provenance line under each field |
| `screenshot-mips-performance.png` | MIPS performance, category score bars |
| `screenshot-quality-measures.png` | Hospital quality measures with national-comparison badges |

They are **placeholders**: the files are not committed. `.gitignore` and
`.dockerignore` both exclude `*.png` repo-wide (screenshots are a
never-commit file type here), so drop the redacted exports in alongside this
README at publish time rather than checking them in.

Redact before exporting: no real provider names, NPIs, or addresses, and no
internal hostnames or URLs in the browser chrome. The page is public.
