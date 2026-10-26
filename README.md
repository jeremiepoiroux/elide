# Elide

**Anonymize research interviews — privately, in your browser, no account needed.**

Elide runs entirely on your device. Nothing is sent to any server.

## What it does

- Import fieldwork documents: interviews, field notes, meeting notes or other (`.txt`, `.md`, `.docx`, `.rescribe.json`, `.corpus.json`)
- Automatically detect names, places, organizations, and dates
- Tag them with colored labels — or do it by hand
- Replace names with pseudonyms
- Variants (case, accents, hyphens) and homonyms are flagged for review (⚑) instead of being guessed
- Export the anonymized text as `.txt`, `.pdf`, or `.docx`
- Work on spreadsheets of quotes (`.xlsx`, `.xls`, `.csv`): choose which columns to anonymize, tag cells in a table view (search, sort, edit the other columns, delete rows), export back to `.xlsx`, `.xls` or `.csv`
- Export validated documents for analysis as a `.corpus.json` bundle

## How to use

Just open `index.html` in your browser. No installation, no setup.

You can also use the hosted version on GitHub Pages.

## Pipeline

```
Rescribe  ──.rescribe.json / .corpus.json (raw)──▶  Elide  ──.corpus.json (anonymized)──▶  analysis tool
transcript cleanup                                  anonymization + human validation        coding / analysis
```

Elide reads and writes the shared format described in [`corpus-schema/corpus.schema.json`](corpus-schema/corpus.schema.json).

**Import.** A `.rescribe.json` carrying a `corpus` block, a single `corpus-doc` or a whole `corpus-bundle` is read directly: document, speaker and segment ids are kept, as are the metadata and the provenance chain. Older `.rescribe.json` files without `corpus` are still read (the transcript HTML is parsed). Plain `.txt` / `.md` / `.docx` files get stable segment ids (`seg_0001`…) once, at import. The re-editable Rescribe project embedded in a bundle (`ext.rescribe`) is ignored and never stored.

**Export for analysis** (project view → *For analysis (.corpus.json)*): only documents marked as validated, with no tag left to review, are included. Each document is `sensitivity: "anonymized"` and contains only:

- the anonymized text of each segment, with its id, speaker id, time and hash;
- speakers as tags (`[ENQ]`, `[ENQ·E_1]`, `[PERS_2]`…), never their names;
- the list of tags present (type and count), never their real value;
- the review status and the provenance chain (file names removed);
- the study title, date and mode — the interview title, transcriber name and free metadata fields stay on the device.

Before writing the file, Elide scans every value of the bundle for any real value it knows (entity bank, speaker names), ignoring case, accents, ligatures, apostrophe and dash variants, and invisible characters (zero-width spaces, soft hyphens). If one is found, the export stops and lists the segment and expected tag: fix it in the editor, or confirm that the occurrence is not identifying and use *Export anyway*. Words you deliberately kept as is must be confirmed one by one.

The scan has its own test suite, run against the shipped `index.html` (Node 18+):

```
node --test tests/scan.test.mjs tests/parser.test.mjs tests/table.test.mjs
```

**What leaves the device:** only the files you export yourself. **What never leaves it:** the raw text, the pseudonym key (real value ↔ tag), the entity bank, corrections and original file names. The private `.elide.json` project file still contains everything — it is a working file, keep it private.

## Spreadsheets

At import, each column gets a role: **text to anonymize** (quotes, comments — every cell is tagged like interview text), **participant / speaker** (replaced by its tag, e.g. `[ENQ·E_1]`), **keep as is** (theme, code, page — editable in the table view) or **do not import**. Elide suggests the roles from the column names and contents. Each sheet of a workbook becomes a document; `.csv` files are read as UTF-8 or Windows-1252, with `,`, `;` or tab as separator.

Quotes themselves can't be edited in Elide (tags stay reliable): fix a typo in the source file and import it again. The spreadsheet library ([SheetJS](https://sheetjs.com), Apache 2.0) is downloaded on first use only, like the `.docx` reader; your files never leave the device.

A workbook with several sheets can be exported back as a whole (*Export → Whole workbook (.xlsx)*): one anonymized sheet per imported sheet, in the original order, named after the titles chosen at import. Sheets that are not validated are listed first, with an *Export anyway* option. A participant gets the same tag in every sheet of the workbook.

In the export for analysis, one quote cell is one segment; the other columns travel in `ext.elide.table` and are scanned for real values like everything else.

## Automatic detection

Elide includes a multilingual name-detection model (FR, EN, DE) that runs locally in your browser — no internet connection required after the first load.

Optional: connect a local [spaCy](https://spacy.io) or [CamemBERT](https://camembert-model.fr) server for higher accuracy, or use [Ollama](https://ollama.com) for LLM-based anonymization.

Projects can be marked **multilingual** when interviews mix languages: the local servers then use a multilingual model (`xx_ent_wiki_sm` for spaCy, `bert-base-multilingual-cased-ner-hrl` for the HF server).

## Languages

French · English · German

## Changelog

**0.3.4**
- Security: imported `.rescribe.json` HTML is parsed in an inert document; segment text is escaped in the HTML/PDF exports; titles, project names and tags are no longer interpolated into inline handlers.

**0.3.3**
- Spreadsheet import: coding tables without a header row are recognised (column names guessed from content: No., Time, Code, Quote), theme rows become a *Section* column, column names can be edited in the import dialog, which is now readable with long names. New document types *Coding table* and *Quote list* (exported as kind `other` with `meta.genre`).

**0.3.2**
- Whole-workbook export: every sheet of a multi-sheet import in one anonymized `.xlsx`, with a check that sheets are validated. Participants are numbered across the whole workbook, so a person keeps the same tag in every sheet. The export menu stays on screen in narrow windows.

**0.3.1**
- Empty project and home page list all import/export formats (spreadsheets, `.corpus.json`). Several files can be selected or dropped at once; they are imported one after the other.

**0.3.0**
- Spreadsheets: import `.xlsx`, `.xls`, `.csv` (column roles, one document per sheet), table view in the editor (tagging, search, sort, editable "keep as is" columns, row deletion with undo), export to `.xlsx`, `.xls`, `.csv`, and rows as segments in the export for analysis. Tests in `tests/table.test.mjs`.

**0.2.4**
- Export for analysis: when known values are found, an "Export anyway" button lets you confirm them (one by one or "select all"). Occurrences in the text are remembered as kept as is; title/metadata occurrences are confirmed for that export only. The exported document's provenance notes how many were confirmed (`confirmedInClear=N`). Internal fields still block the export.

**0.2.3**
- Clicking a speaker label (`[ENQ·E]`…) shows the speaker's real name instead of `SPK`, without the restore/change-tag actions that don't apply to speakers.

**0.2.2**
- Text import: a word followed by ":" no longer becomes a speaker on its own. A label counts as a speaker only if it is used on at least two lines, or is a usual speaker form (`I`, `Q`, `P1`, `JP`, "Interviewer", "Enquêtrice", "Name (I)"…). Bullets, numbered items and one-off labels ("Remarque :") stay in the text. Hyphenated speaker names (`Jean-Pierre :`) are now recognised. Tests in `tests/parser.test.mjs`.

**0.2.1**
- Name variants and privacy scan: ligatures and fullwidth letters (NFKD), `œ`/`æ`/`ß`/`ø`/`ł`/`đ` folded, multi-part names also found in their joined spelling (`Jean-Pierre` ↔ `Jeanpierre`, soft hyphen between parts). New variants are always flagged for review (⚑), never tagged as exact matches.

**0.2.0**
- Shared corpus format: import of Rescribe `corpus` blocks and `.corpus.json` bundles with stable ids; export for analysis with a privacy scan.
- Document type at import (interview, field note, meeting notes, other); field notes are split by paragraph.
- Multilingual projects.
- Tags are stored as ranges over the original text: exact undo per occurrence, variants and homonyms flagged for review (⚑), occurrences kept as is are never re-tagged automatically.
- A document can't be validated while tags remain to review.
- Privacy scan hardened against invisible characters, apostrophe and dash look-alikes; test suite in `tests/scan.test.mjs`.
