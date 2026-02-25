import test from "node:test";
import assert from "node:assert/strict";
import { filterBySearch } from "../../lib/utils.js";

const MODELS = [
  {
    id: "meta/llama-3.1-8b-instruct",
    displayName: "Llama 3.1 8B",
    providerKey: "nvidia",
    tier: "A+",
    aaIntelligence: 42,
  },
  {
    id: "mistralai/mistral-small-3.2-24b-instruct:free",
    displayName: "Mistral Small",
    providerKey: "openrouter",
    tier: "S",
    aaIntelligence: 60,
  },
  {
    id: "google/gemma-3-27b-it",
    displayName: "Gemma 3 27B",
    providerKey: "nvidia",
    tier: "B+",
    aaIntelligence: 30,
  },
];

test("filterBySearch matches model id and display name (case-insensitive)", () => {
  const byId = filterBySearch(MODELS, "llama-3.1");
  const byName = filterBySearch(MODELS, "mistral small");

  assert.equal(byId.length, 1);
  assert.equal(byId[0].id, "meta/llama-3.1-8b-instruct");
  assert.equal(byName.length, 1);
  assert.equal(byName[0].providerKey, "openrouter");
});

test("filterBySearch matches provider, tier, and intelligence score fields", () => {
  assert.equal(filterBySearch(MODELS, "openrouter").length, 1);
  assert.equal(filterBySearch(MODELS, "A+").length, 1);
  assert.equal(filterBySearch(MODELS, "60").length, 1);
});

test("filterBySearch returns all models for empty query", () => {
  assert.equal(filterBySearch(MODELS, "").length, MODELS.length);
});

test("filterBySearch returns empty list for non-matching query", () => {
  const out = filterBySearch(MODELS, "no-such-model-xyz");
  assert.deepEqual(out, []);
});
