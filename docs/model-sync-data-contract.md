# Model Sync Data Contract

`data/model-rankings.json` is the canonical model catalog for the CLI,
terminal UI, and generated site. The model sync workflow refreshes provider
availability, enriches benchmark metadata, and records OpenCode compatibility
without requiring browser-side API calls.

## Ranking Entry Fields

Each `models[]` entry may include:

```ts
{
  source: "nim" | "openrouter";
  model_id: string;
  name: string;
  context: string;
  tier: string;
  swe_bench?: string | null;

  aa_model_id?: string;
  aa_slug?: string;
  aa_url?: string;
  aa_benchmark_score?: number | null;
  aa_benchmark_name?: "coding_index" | "intelligence_index" | null;
  aa_coding_index?: number | null;
  aa_intelligence?: number | null;
  aa_speed_tps?: number | null;
  aa_price_input?: number | null;
  aa_price_output?: number | null;
  aa_updated_at?: string;

  opencode_supported?: boolean | null;
  opencode_compatibility_reason?: string;
}
```

## Benchmark Priority

Artificial Analysis metadata is applied in this order:

1. `evaluations.artificial_analysis_coding_index`
2. `evaluations.artificial_analysis_intelligence_index`
3. Existing stored benchmark fields when the latest fetch is unavailable

The updater must not clear known benchmark values because an external fetch
failed or a model could not be matched confidently.

## Matching Policy

The updater may apply Artificial Analysis metadata only when the match is
deterministic or high confidence:

1. Existing `aa_model_id`
2. Manual alias table
3. Normalized provider model ID
4. Normalized Artificial Analysis slug
5. Normalized model name plus creator slug
6. High-confidence fuzzy match

Uncertain matches must be reported in the sync report instead of applied
silently.

## Sync Report Shape

`data/model-sync-report.json` is optional generated output and should summarize
the run:

```json
{
  "added_models": [],
  "removed_models": [],
  "updated_benchmarks": [],
  "unmatched_provider_models": [],
  "unmatched_artificial_analysis_models": [],
  "opencode_supported": [],
  "opencode_unknown": [],
  "opencode_unsupported": []
}
```

Generated reports should only be committed when the task explicitly requires a
checked-in snapshot.
