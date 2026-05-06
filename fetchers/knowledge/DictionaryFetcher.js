import { stripHtml } from "@rodrigo-barraza/utilities-library";
import { DICTIONARY_BASE_URL } from "../../constants.js";

/**
 * Free Dictionary API fetcher.
 * https://dictionaryapi.dev/ — no auth, fully open.
 * Returns definitions, phonetics, pronunciation audio, synonyms, antonyms.
 */
// ─── Define Word ───────────────────────────────────────────────────
/**
 * Look up a word and return structured definition data.
 * @param {string} word
 * @returns {Promise<object>} Normalized definition result
 */
export async function fetchDefinition(word) {
  const url = `${DICTIONARY_BASE_URL}/${encodeURIComponent(word.toLowerCase().trim())}`;
  const res = await fetch(url);
  if (res.status === 404) {
    return { word, found: false, message: "Word not found" };
  }
  if (!res.ok) {
    throw new Error(`Dictionary API → ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  const entry = data[0];
  // Extract phonetics with audio
  const phonetics = (entry.phonetics || [])
    .filter((p) => p.text || p.audio)
    .map((p) => ({
      text: p.text || null,
      audio: p.audio || null,
    }));
  // Extract meanings grouped by part of speech
  const meanings = (entry.meanings || []).map((m) => ({
    partOfSpeech: m.partOfSpeech,
    definitions: (m.definitions || []).slice(0, 5).map((d) => ({
      definition: stripHtml(d.definition),
      example: d.example ? stripHtml(d.example) : null,
      synonyms: (d.synonyms || []).slice(0, 5),
      antonyms: (d.antonyms || []).slice(0, 5),
    })),
    synonyms: (m.synonyms || []).slice(0, 10),
    antonyms: (m.antonyms || []).slice(0, 10),
  }));
  return {
    word: entry.word,
    found: true,
    phonetic: entry.phonetic || phonetics[0]?.text || null,
    phonetics,
    meanings,
    sourceUrls: entry.sourceUrls || [],
  };
}
