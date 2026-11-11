// Style learning input, prepared without AI (see the AI REQUESTS update's
// research-style.md): reply pairs (client message(s) → my reply), follow-ups
// sent after the client went quiet, and measured stats per channel.
const LABEL = { email: 'Email', whatsapp: 'WhatsApp' };
const CLIENT_CLIP = 500, ME_CLIP = 1500, DAY = 864e5;

// Phone numbers and email addresses out of the examples.
export const anonymize = (s) => s
  .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
  .replace(/\+?\d[\d \-]{7,}\d/g, '<phone>');

const clip = (s, n) => (s.length > n ? s.slice(0, n) + ' …' : s);
const isMedia = (m) => /^\[[\w ]+\]$/.test(m.text.trim());
const words = (s) => s.split(/\s+/).filter(Boolean).length;
const pct = (xs, f) => (xs.length ? Math.round((100 * xs.filter(f).length) / xs.length) : 0);
const quantile = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0; };
const EMOJI = /\p{Extended_Pictographic}/gu;
function top(xs, n = 8) {
  const c = {};
  for (const x of xs) if (x) c[x] = (c[x] || 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} (${v})`);
}

export function styleStats(mine) {
  const out = {};
  for (const ch of Object.keys(LABEL)) {
    const ms = mine.filter((m) => m.channel === ch).map((m) => m.text.trim()).filter(Boolean);
    if (!ms.length) continue;
    const lens = ms.map(words);
    const lines = ms.map((t) => t.split('\n').map((l) => l.trim()).filter(Boolean));
    out[ch] = {
      messages: ms.length,
      wordsMedian: quantile(lens, 0.5), wordsP90: quantile(lens, 0.9),
      emojiPerMessage: +(ms.reduce((n, t) => n + (t.match(EMOJI) || []).length, 0) / ms.length).toFixed(2),
      topEmoji: top(ms.flatMap((t) => t.match(EMOJI) || []), 5),
      withExclamationPct: pct(ms, (t) => t.includes('!')), withQuestionPct: pct(ms, (t) => t.includes('?')),
      withEllipsisPct: pct(ms, (t) => /…|\.\.\./.test(t)), withSmileyPct: pct(ms, (t) => /[:;]-?[)D(]/.test(t)),
      startsCapitalPct: pct(ms, (t) => /^\p{Lu}/u.test(t)), endsWithoutPeriodPct: pct(ms, (t) => !/[.!?…]$/.test(t)),
      withCzechDiacriticsPct: pct(ms, (t) => /[áčďéěíňóřšťúůýž]/i.test(t)),
      // Opening: the first line up to its first punctuation or emoji, max 2 words.
      topOpenings: top(lines.map((l) => l[0]?.split(/[,.!?…:;]|\p{Extended_Pictographic}/u)[0].trim().split(/\s+/).slice(0, 2).join(' '))),
      topClosings: top(lines.map((l) => l.at(-1)?.split(/\s+/).slice(-2).join(' '))),
    };
  }
  return out;
}

const renderPair = (p, i) => `<pair id="${i + 1}" channel="${p.channel}" stage="${p.stage}" date="${p.at.slice(0, 10)}">
<client>${p.client}</client>
<me>${p.me}</me>
</pair>`;

// people: snapshot people with messages (oldest first). A run of my messages
// in a row is one reply; it's a follow-up when the client was quiet for a day+.
export function styleCorpus(people) {
  const pairs = [], followups = [], mine = [];
  for (const p of people) {
    const msgs = (p.messages || []).filter((m) => m.text && !isMedia(m));
    let client = [], lastClientAt = null, i = 0;
    while (i < msgs.length) {
      const m = msgs[i];
      if (!m.fromMe) { client.push(m); lastClientAt = m.at; i++; continue; }
      const run = [];
      while (i < msgs.length && msgs[i].fromMe && msgs[i].channel === m.channel) run.push(msgs[i++]);
      mine.push(...run);
      const me = anonymize(clip(run.map((r) => r.text.trim()).join('\n\n'), ME_CLIP));
      const base = { channel: m.channel, stage: p.stage?.label || 'unknown', at: m.at, me };
      const quiet = !lastClientAt || new Date(m.at) - new Date(lastClientAt) > DAY;
      if (client.length && !quiet) pairs.push({ ...base, client: anonymize(clip(client.map((c) => c.text.trim()).join('\n'), CLIENT_CLIP)) });
      else followups.push({ ...base, client: '' });
      client = [];
    }
  }
  const byDate = (a, b) => a.at.localeCompare(b.at);
  return { stats: styleStats(mine), pairs: pairs.sort(byDate), followups: followups.sort(byDate), count: mine.length };
}

// Data first, the instructions last (they're the user's editable prompt).
export const stylePromptInput = ({ stats, pairs, followups }, instructions) =>
  `<stats>${JSON.stringify(stats, null, 1)}</stats>\n<pairs>\n${pairs.map(renderPair).join('\n')}\n</pairs>\n` +
  `<followups>\n${followups.map(renderPair).join('\n')}\n</followups>\n\n${instructions}`;
