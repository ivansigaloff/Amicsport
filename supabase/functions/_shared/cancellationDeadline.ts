// Shared: is a match's cancellation deadline past? Mirrors the wall-clock-in-
// Madrid comparison in refund-payment (both "now" and the deadline are Madrid
// wall-clock instants, so DST offsets cancel out). New shared helper used by the
// WhatsApp paid-leave flow; refund-payment keeps its inline copy until they are
// unified at integration.
export function isPastCancellationDeadline(
  matchDate: string,
  time: string,
  cancellationHours: number | null,
): boolean {
  const [y, mo, d] = String(matchDate).split('-').map(Number);
  const [h, mi] = String(time).split(':').map(Number);
  if ([y, mo, d, h, mi].some((n) => Number.isNaN(n))) return false;  // unresolved → don't block

  const startWall = Date.UTC(y, mo - 1, d, h, mi);
  const limitHours = cancellationHours || 12;
  const deadlineWall = startWall - limitHours * 60 * 60 * 1000;

  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Madrid',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value);
  const nowWall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));

  return nowWall > deadlineWall;
}
