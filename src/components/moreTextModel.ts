/** Text up to this length is always shown whole. */
export const MORE_TEXT_LIMIT = 160;
/** A tail shorter than this is not worth a toggle. */
const MIN_TAIL = 40;
/** The first sentence must have some substance ("Off by default." still counts). */
const MIN_LEAD = 12;

/**
 * Splits long text into its first sentence and the rest, for a "More" toggle. Returns null when the text should be shown
 * whole: short text, or text whose first sentence is almost all of it.
 */
export function splitLead(text: string): { lead: string; rest: string } | null {
  if (text.length <= MORE_TEXT_LIMIT) return null;
  const end = /[.!?](?=\s)/g;
  let match: RegExpExecArray | null;
  while ((match = end.exec(text)) !== null) {
    const cut = match.index + 1;
    if (cut < MIN_LEAD) continue;
    const lead = text.slice(0, cut);
    const rest = text.slice(cut).trim();
    if (rest.length < MIN_TAIL) return null;
    return { lead, rest };
  }
  return null;
}
