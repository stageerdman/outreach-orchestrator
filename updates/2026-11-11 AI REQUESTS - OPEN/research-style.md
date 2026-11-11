# Research: learning and copying the user's writing style

Spike for "research open-source frameworks on how to copy a writing style, then
copy it and save it". Setup: one headless `claude -p` run (no tools) over about
400 sent WhatsApp messages and 25 sent emails, plus the client messages they
answered. The output is a style guide that later draft prompts load. No
fine-tuning, the messages are Czech, and the corpus is small and chatty.

## 1. What exists

| Name | Link / license | What it captures | Fit for us |
|---|---|---|---|
| **PROSE** (Apple, ICML 2025) | [paper](https://arxiv.org/abs/2505.23815), [apple/ml-predict](https://github.com/apple/ml-predict) (Apple sample-code license) | Infers a written *preference description* from the user's samples, then refines it: generate with the description, compare the result to the real sample, fix the description, and check that it holds on other samples. Tested on emails. | **High (as a method).** Our "guide + examples" approach is the same idea. The paper reports +33% over earlier description methods and +9% more when combined with in-context examples, so description and examples work best together. |
| **HyPerAlign** (2025) | [paper](https://arxiv.org/abs/2505.00038) (no code found) | Asks an LLM for up to 10 ranked, user-specific hypotheses about style, tone, formality, politeness and discourse habits, then puts them in the generation prompt. | **High.** Shows that a short list of specific, falsifiable traits beats vague persona text, and that the traits carry over between models. |
| **Catch Me If You Can?** (EMNLP 2025 Findings) | [paper](https://arxiv.org/abs/2509.14543), [code, MIT](https://github.com/jaaack-wang/llms-implicit-writing-styles-imitation) | A benchmark of few-shot implicit style imitation across 400+ authors. | **High (lessons).** Email is the easiest domain (about 96% attribution with 5 examples); informal forum/blog text is much harder. Gains level off by 5 examples. **Picking examples by topic similarity hurt.** Giving the model the opening of the target text helped most. |
| **jrenaldi79/writing-style** | [GitHub, MIT](https://github.com/jrenaldi79/writing-style) | Email voice fingerprint (formality, rhythm, mechanics, lexicon, tone markers, each scored 1–10 with an instruction), greetings and closings, **personas per recipient and email type** (clustered), 3–5 examples per persona, blind check on a 15% held-out set. | **High (structure).** Personas per situation are a good fit for our pipeline stages. The embedding and clustering machinery is overkill at ~425 messages, because the LLM can sort them by situation itself. |
| **chatlectify** | [GitHub, MIT](https://github.com/0x1Adi/chatlectify) | Chat history → `SKILL.md`. 20+ stylometric metrics (type-token ratio, sentence length, punctuation histogram), stratified exemplars, **anti-patterns**, quantified targets. Cleans and dedupes the input first. | **High (output format).** Hard numbers ("median 9 words") and a "never do" list are better than adjectives. We can compute the numbers in Node with no dependencies. |
| **faststylometry** / **stylo** | [faststylometry, MIT](https://github.com/fastdatascience/faststylometry), [stylo (R), GPL-3](https://github.com/computationalstylistics/stylo) | Burrows' Delta on frequent function words for authorship attribution. Works with any language, Czech included. | **Low for generation, optional for checking.** Could score whether drafts sound like the user. Needs more text than we have, so not worth adding Python or R. |
| **LUAR** / **TinyStyler** / **StyleRemix** | [LUAR, Apache-2.0](https://github.com/llnl/luar), [TinyStyler](https://arxiv.org/abs/2406.15586) ([HF](https://huggingface.co/tinystyler/tinystyler)), [StyleRemix, Apache-2.0](https://github.com/jfisher52/StyleRemix) | Learned authorship embeddings (LUAR), a small model that rewrites text toward a style embedding (TinyStyler), and LoRA modules per style axis such as formality, length and sarcasm (StyleRemix). | **Low.** They need local models, were trained on English Reddit data, and don't fit a prompt-only setup. StyleRemix's axes are still a useful checklist. |
| **Anthropic prompting guide** | [Claude prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices) | Examples should be relevant, **diverse** and wrapped in `<example>` tags. 3–5 examples work best. Put long data at the top and the query at the end. The prompt's own formatting rubs off on the output. | **High.** Shapes how both prompts are built. |

The many "write like me" GPTs and skill packs (for example
[writelikeme](https://github.com/97115104/writelikeme)) are mostly a single
prompt with no checking. Nothing in them goes beyond what is listed above.

## 2. Recommended method

Combine PROSE/HyPerAlign (explicit, specific traits that get checked) with the
benchmark's few-shot lessons (a handful of diverse examples, not chosen by
topic) and chatlectify's format (numbers plus anti-patterns).

**A. Prepare the data in Node, before calling Claude (no LLM):**
- Build **reply pairs**: the client message(s) right before each user message
  in the same chat, plus the stage and task kind when known (`stageOf`). Also
  keep **follow-ups after no reply**: user messages sent after more than 24 h
  with no client message in between.
- Clean the text: drop media placeholders, links and signatures; collapse
  near-duplicates (copy-pasted templates count once, but note that they are
  templates). Replace phone numbers and emails with `<phone>` and `<email>`.
- Compute **hard stats per channel** and pass them in as facts: median and p90
  length in words and characters, messages per turn (several WhatsApp messages
  in a row?), emoji per message and the top emoji, `!`, `?`, `…` and `:)`
  rates, share of messages starting with a capital letter, share without a
  final period, diacritics use (does the user ever write Czech without
  háčky/čárky?), and the most common opening and closing words.
- Hold out ~15% of pairs for a later check (step D).

**B. Dimensions the guide must cover** (each with numbers and quotes, not
adjectives):
1. **Addressing:** tykání vs. vykání, and when it switches (does the client go
   first? by age? after a meeting?). Form of address: first name, *pane/paní* +
   surname in the vocative (*pane Nováku*), or none.
2. **Openings and sign-offs** per channel (*Dobrý den*, *Ahoj*, *Zdravím*;
   *Hezký den*, *S pozdravem*, a name or initials, or nothing).
3. **Length and rhythm:** sentence and message length, one long message vs.
   several short ones, line breaks.
4. **Mechanics:** punctuation, emoji, capital letters, diacritics, typos the
   user tolerates, abbreviations (*dík*, *ok*, *jj*).
5. **Vocabulary:** pet phrases, filler words, sales words they use and avoid,
   diminutives, and English loanwords.
6. **Moves per situation:** first contact with a new lead, after an unanswered
   call, booking or confirming a meeting (how times are offered: exact slots or
   "kdy se Vám hodí?"), reminding before a meeting, after a no-show, after a
   consultation ("thinking about it"), objections (price, time, "musím to
   probrat"), payment and installments, and **follow-up after no reply** (how
   pushy, how many days, what changes in the 2nd and 3rd follow-up).
7. **Email vs. WhatsApp** differences.
8. **Anti-patterns:** things the user never does (for example: no bullet lists
   in WhatsApp, never "Doufám, že se máte dobře", no exclamation marks), plus
   generic AI-sounding Czech phrasing to avoid.

**C. Output format** (`style-guide.md` in the app data folder, never in the
repo, because it quotes real messages): Markdown in the language of the
messages, at most ~1,500 words, with these sections: *Shrnutí* (5 lines),
*Čísla* (the stats table), the dimensions 1–8 with short quotes, *Situace*
(one paragraph per situation with what the user typically does), *Nikdy*
(anti-patterns), and **8–15 verbatim examples**, each as `<example
situation="…" channel="…">` with the client message and the user's reply.
Choose examples for **diversity of situation and channel**, never by topic
similarity: at least one each for new lead, no answer, booking, objection,
no-show, after a consultation, and follow-up with no reply; 2–3 emails; the
rest WhatsApp. Real pairs only, anonymised (client names → `{jméno}`).

**D. Check it once (the PROSE step, optional but cheap):** a second
`claude -p` call gets the guide plus the client side of 5 held-out pairs,
drafts replies, and is then shown the real replies and asked for corrections
to the guide ("the guide says X, the real reply did Y"). Apply them and save.
Skip this step if it takes too long; the guide alone is still useful.

**E. At generation time:** the system prompt holds the full guide (static, so
it caches well). The user turn holds the person's recent timeline (the last
~10 messages, oldest first, in `<conversation>`), the stage and task, then the
request ("draft a follow-up, WhatsApp"). Tell the model to choose tykání or
vykání **from this conversation's history first and the guide second**, to
match the per-channel length target, and to return only the message text. Add
2–3 more examples from the same situation only if the guide's examples don't
cover it (stage match, not topic match). Rebuild the guide on demand (a
button) rather than on every refresh.

## 3. Style-learning prompt (draft)

Inputs: `{{stats}}` (JSON from step A), `{{pairs}}` (all reply pairs as
`<pair id channel stage date>` containing `<client>…</client><me>…</me>`,
oldest first, about 425 of them), `{{followups}}` (follow-ups sent with no
reply in between, same format, empty `<client>`), `{{user_name}}`. Put the
data first and the instructions last.

```text
<stats>{{stats}}</stats>
<pairs>{{pairs}}</pairs>
<followups>{{followups}}</followups>

You are building a writing-style guide for {{user_name}}, a salesperson who
writes to clients on WhatsApp and by email. Above are real messages they
sent (<me>), each with the client message it answered (<client>), plus
follow-ups sent after the client went silent, and measured statistics. Another
model will later use your guide to draft new messages that the clients
cannot tell apart from {{user_name}}'s own.

Write the guide in the language the <me> messages are written in (likely
Czech). Rules:
- Describe only what the messages show. Every claim must be specific and
  checkable (numbers, exact words) and backed by a short verbatim quote.
  No generic adjectives like "friendly" or "professional" without evidence.
- Use the numbers in <stats> as given; do not re-estimate them.
- Separate WhatsApp from email wherever they differ.
- Cover: forms of address (tykání vs. vykání and what triggers each,
  vocative forms, first name vs. surname); openings and sign-offs; length,
  rhythm and splitting into several messages; punctuation, emoji, capital
  letters, diacritics, abbreviations; recurring phrases and words avoided;
  how they handle each situation: first contact, unanswered call, offering
  and confirming meeting times, reminders, no-show, after a consultation,
  objections (price, time, "need to think/discuss"), payment, and
  follow-ups after no reply (timing, tone, how the 2nd/3rd differ).
- Add a "Never" section: things this person never does, plus generic or
  AI-sounding phrasings that would give a draft away.
- Some messages are pasted templates; say which and how they are adapted.
- Then pick 8-15 examples verbatim from <pairs>/<followups>, chosen for
  diversity of situation and channel (at least: new lead, no answer,
  booking, objection, no-show, after consultation, follow-up with no
  reply; 2-3 emails). Do not choose by topic. Replace client names with
  {jméno} and leave everything else unchanged, including typos.

Output only the guide as Markdown, at most ~1500 words plus examples, with
sections in this order: Summary (5 lines), Numbers, Addressing, Openings and
sign-offs, Length and rhythm, Mechanics, Vocabulary, Situations, Email vs.
WhatsApp, Never, Examples. Translate the section names into the guide's
language. Format each example as:
<example situation="..." channel="whatsapp|email">
<client>...</client>
<me>...</me>
</example>
```

Size: ~425 short messages plus the client side is roughly 40–70k tokens, which
fits one call. If it gets too large, trim long client emails to their first
~500 characters rather than dropping pairs.
