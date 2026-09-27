// Allow-list formatter for ARIA answers.
//
// ARIA replies may contain light HTML emphasis (<b>, <i>, <u> — the backend
// prompt asks the LLM for these) but the text is built from UNTRUSTED inputs:
// LLM output (prompt-injectable), telemetry fields such as machine names and
// alert messages (anyone who can publish to the MQTT broker controls these),
// and knowledge-base content. Rendering it raw via dangerouslySetInnerHTML is
// an XSS hole, so we escape EVERYTHING first and then re-enable only a fixed
// set of attribute-less formatting tags. No attributes can survive, so no
// event handlers, URLs, or styles can be smuggled through.

const ALLOWED_TAGS = ['b', 'i', 'u', 'strong', 'em', 'br'];

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const ALLOWED_TAG_RE = new RegExp(
  `&lt;(\\/?)(${ALLOWED_TAGS.join('|')})\\s*\\/?&gt;`,
  'gi',
);

export function formatAriaAnswer(text: string): string {
  let html = escapeHtml(text ?? '');
  // Re-enable the exact allow-listed tags (no attributes possible: any
  // attribute makes the pattern fail to match, leaving it escaped).
  html = html.replace(ALLOWED_TAG_RE, (_m, slash: string, tag: string) => {
    const t = tag.toLowerCase();
    if (t === 'br') return '<br />';
    return `<${slash}${t}>`;
  });
  // LLMs often fall back to markdown bold despite instructions; render it too.
  html = html.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  return html;
}
