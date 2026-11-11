// Template placeholders, shared by the UI and the tests (same rules as the
// MenuBarTemplates app): {{ NAME }} with an uppercase name, and
// {{gender:male text|female text}}. A field that is not included removes its
// placeholder; an empty value leaves the placeholder as it is.
const SP = '(?:\\s|&nbsp;)*';
const FIELD = new RegExp(`\\{\\{${SP}([\\p{Lu}0-9_ -]+?)${SP}\\}\\}`, 'gu');
const GENDER = /\{\{gender:([^|{}]*)\|([^{}]*)\}\}/g;
const escHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };
const decode = (s) => s.replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (_, e) => ENTITIES[e]);

export function placeholders(subject, bodyHtml) {
  const names = [];
  for (const m of `${subject}\n${bodyHtml.replace(/<[^>]+>/g, ' ')}`.matchAll(FIELD)) {
    const name = m[1].trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

export const hasGender = (subject, bodyHtml) => new RegExp(GENDER.source).test(subject + bodyHtml);

// values: { NAME: { value, include } }; html: escape values for an HTML body.
export function resolve(text, values = {}, gender = 'female', html = false) {
  return text
    .replace(GENDER, (_, male, female) => (gender === 'male' ? male : female))
    .replace(FIELD, (all, raw) => {
      const v = values[raw.trim()];
      if (!v) return all;
      if (v.include === false) return '';
      return v.value ? (html ? escHtml(v.value) : v.value) : all;
    });
}

// Plain-text fallback for the clipboard: block ends and <br> become line breaks.
export function htmlToText(html) {
  return decode(html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/(p|div|h\d|li|ul|ol|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
