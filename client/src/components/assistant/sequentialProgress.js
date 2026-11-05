/** Display the verified checklist before allowing another action to be planned. */
export async function showVerifiedProgress({ publish, paint, pause, stopped, delayMs }) {
  if (stopped()) return false;
  publish();
  await paint();
  if (stopped()) return false;
  await pause(delayMs);
  return !stopped();
}
