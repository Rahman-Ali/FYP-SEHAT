// Helpers shared by the Library screen and chat citations (no book or disease lists here:
// everything comes from the documents API).

const normalize = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/diarrhoea/g, "diarrhea") // same disease, UK/US spelling
    .replace(/\(?\s*part\s*\d+\s*\)?/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// True when a Library entry name (e.g. "Urinary Tract Infection (UTI) Part 1") is about a
// disease tag from the index (e.g. "uti", "common_cold", "hepatitis_a").
export const entryMatchesDisease = (entryName, diseaseTag) => {
  const phrase = normalize(String(diseaseTag || "").replace(/_/g, " "));
  if (!phrase) return false;
  return ` ${normalize(entryName)} `.includes(` ${phrase} `);
};

export const findDocument = (library, { docId, title } = {}) => {
  for (const group of library?.diseases || []) {
    for (const doc of group.documents || []) {
      if (docId && doc.doc_id === docId) return doc;
      if (!docId && title && doc.title === title) return doc;
    }
  }
  return null;
};

// Page numbers of a chat citation, 1-based. New citations carry doc_id + integer pages;
// older messages stored 0-based page strings.
export const citationPages = (source) => {
  const raw = Array.isArray(source?.pages) ? source.pages : [];
  const legacy = !source?.doc_id;
  return raw
    .map((p) => Number(p))
    .filter((p) => Number.isFinite(p))
    .map((p) => (legacy ? p + 1 : p))
    .filter((p) => p >= 1);
};

export const formatSize = (mb) => {
  if (!Number.isFinite(mb)) return "";
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(mb * 1024))} KB`;
};
