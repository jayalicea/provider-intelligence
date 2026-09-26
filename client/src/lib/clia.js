// CLIA certificate type codes from the CMS POS Clinical Laboratories file.
// Verified against CMS certificate definitions (Certificate of Registration
// = 9, Certificate of Compliance = 1, per Ohio Medicaid manuals quoting CMS;
// Waiver/Accreditation/PPMP per the standard CLIA certificate set).
// Unknown codes render as "Type N" rather than being guessed.
export const CERT_TYPE_LABELS = {
  1: 'Certificate of Compliance',
  2: 'Certificate of Waiver',
  3: 'Certificate of Accreditation',
  4: 'PPMP (physician-performed microscopy)',
  9: 'Certificate of Registration',
}

export function certTypeLabel(code) {
  if (code == null || code === '') return 'Not available'
  return CERT_TYPE_LABELS[code] || `Type ${code}`
}
