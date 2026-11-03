/**
 * Turns a consult draft's structured doctor_notes into the plain text that
 * goes in the Consultancy Notes box. Mirrors the server's approve formatting
 * so approving and inserting give the same text.
 */
export function draftToNotesText(doctorNotes) {
  if (!doctorNotes) return '';
  const plan = (doctorNotes.plan_and_recommendations || [])
    .map((r) => `- ${r.recommendation}`)
    .join('\n');

  return [
    doctorNotes.chief_complaint ? `CHIEF COMPLAINT:\n${doctorNotes.chief_complaint}\n` : '',
    doctorNotes.vitals_observed ? `VITALS OBSERVED:\n${doctorNotes.vitals_observed}\n` : '',
    doctorNotes.assessment ? `ASSESSMENT:\n${doctorNotes.assessment}\n` : '',
    plan ? `PLAN & RECOMMENDATIONS:\n${plan}` : '',
  ]
    .filter(Boolean)
    .join('\n')
    .trim();
}
