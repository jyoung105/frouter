// lib/models.js — NIM hardcoded list + OpenRouter dynamic fetch
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { getApiKey } from './config.js';

// ─── model-rankings.json lookup ────────────────────────────────────────────────
// Populated lazily on first call to lookupRankings().
let _byId   = null;   // Map<model_id, entry>
let _bySlug = null;   // Map<aa_slug,  entry>

function loadRankings() {
  if (_byId) return;
  _byId   = new Map();
  _bySlug = new Map();
  try {
    const __dir = dirname(fileURLToPath(import.meta.url));
    const raw   = readFileSync(join(__dir, '..', 'model-rankings.json'), 'utf8');
    for (const m of JSON.parse(raw).models) {
      _byId.set(m.model_id, m);
      _byId.set(m.model_id.replace(':free', ''), m);   // bare ID without :free
      if (m.aa_slug) _bySlug.set(m.aa_slug, m);
      // Also index by slug derived from model_id for cross-namespace matching
      // e.g. "meta/llama-3.3-70b-instruct" → "llama-3-3-70b" catches "meta-llama/llama-3.3-70b-instruct:free"
      const derivedSlug = toSlugKey(m.model_id.replace(':free', ''));
      if (derivedSlug && !_bySlug.has(derivedSlug)) _bySlug.set(derivedSlug, m);
    }
  } catch { /* rankings file missing or malformed — degrade gracefully */ }
}

// Derive a slug-like key from a raw model ID for fuzzy matching.
// e.g. "google/gemma-3-27b-it" → "gemma-3-27b"
function toSlugKey(id) {
  return id.split('/').pop()
    .toLowerCase()
    .replace(/[._]/g, '-')
    .replace(/-(instruct|it|fp8|preview|turbo|versatile|2507|2512|2506|v\d+[\d.]*|a\d+b).*$/, '');
}

function lookupRankings(id) {
  loadRankings();
  if (_byId.has(id))  return _byId.get(id);
  const bare = id.replace(':free', '');
  if (_byId.has(bare)) return _byId.get(bare);
  const slug = toSlugKey(bare);
  if (_bySlug.has(slug)) return _bySlug.get(slug);
  // Partial slug match — rankings slug starts with derived slug or vice-versa
  for (const [s, entry] of _bySlug) {
    if (slug.length >= 6 && (slug.startsWith(s) || s.startsWith(slug))) return entry;
  }
  return null;
}

function scoreTier(s) {
  if (s == null) return '?';
  if (s >= 70) return 'S+';
  if (s >= 60) return 'S';
  if (s >= 50) return 'A+';
  if (s >= 40) return 'A';
  if (s >= 35) return 'A-';
  if (s >= 30) return 'B+';
  if (s >= 20) return 'B';
  return 'C';
}

function makeModel(id, displayName, context, providerKey) {
  const ranking   = lookupRankings(id);
  const sweScore  = ranking?.swe_bench ? parseFloat(ranking.swe_bench) : null;
  const tier      = ranking?.tier || scoreTier(sweScore);
  return {
    id,
    displayName,
    context:        context || 32768,
    providerKey,
    sweScore,
    tier,
    aaIntelligence: ranking?.aa_intelligence ?? null,
    aaSpeedTps:     ranking?.aa_speed_tps    ?? null,
    pings:          [],
    status:         'pending',
    httpCode:       null,
  };
}

// ─── NVIDIA NIM hardcoded model list ─────────────────────────────────────────
// Full list of free chat/instruct models from https://integrate.api.nvidia.com/v1/models
const NIM_MODELS = [
  // ── S+ tier ────────────────────────────────────────────────────────────────
  makeModel('z-ai/glm5',                                        'GLM 5',                     131072, 'nvidia'),
  makeModel('moonshotai/kimi-k2.5',                              'Kimi K2.5',                 131072, 'nvidia'),
  makeModel('z-ai/glm4.7',                                      'GLM 4.7',                   204800, 'nvidia'),
  makeModel('stepfun-ai/step-3.5-flash',                         'Step 3.5 Flash',            262144, 'nvidia'),
  makeModel('minimaxai/minimax-m2.1',                            'MiniMax M2.1',              204800, 'nvidia'),
  makeModel('mistralai/devstral-2-123b-instruct-2512',           'Devstral 2 123B',           262144, 'nvidia'),
  makeModel('qwen/qwen3-235b-a22b',                              'Qwen3 235B',                131072, 'nvidia'),
  makeModel('qwen/qwen3-coder-480b-a35b-instruct',              'Qwen3 Coder 480B',          262144, 'nvidia'),

  // ── S tier ─────────────────────────────────────────────────────────────────
  makeModel('deepseek-ai/deepseek-v3.2',                         'DeepSeek V3.2',             131072, 'nvidia'),
  makeModel('moonshotai/kimi-k2-thinking',                       'Kimi K2 Thinking',          262144, 'nvidia'),
  makeModel('moonshotai/kimi-k2-instruct',                       'Kimi K2 Instruct',          131072, 'nvidia'),
  makeModel('moonshotai/kimi-k2-instruct-0905',                  'Kimi K2 0905',              131072, 'nvidia'),
  makeModel('minimaxai/minimax-m2',                               'MiniMax M2',                131072, 'nvidia'),
  makeModel('deepseek-ai/deepseek-v3.1',                         'DeepSeek V3.1',             131072, 'nvidia'),
  makeModel('deepseek-ai/deepseek-v3.1-terminus',                'DeepSeek V3.1 Term.',       131072, 'nvidia'),
  makeModel('openai/gpt-oss-120b',                               'GPT OSS 120B',              131072, 'nvidia'),
  makeModel('meta/llama-4-maverick-17b-128e-instruct',           'Llama 4 Maverick',          524288, 'nvidia'),
  makeModel('qwen/qwen3-next-80b-a3b-instruct',                  'Qwen3 80B Instruct',        131072, 'nvidia'),
  makeModel('qwen/qwen3-next-80b-a3b-thinking',                  'Qwen3 80B Thinking',        131072, 'nvidia'),
  makeModel('qwen/qwen3.5-397b-a17b',                            'Qwen3.5 400B',              131072, 'nvidia'),

  // ── A+ tier ────────────────────────────────────────────────────────────────
  makeModel('mistralai/mistral-large-3-675b-instruct-2512',      'Mistral Large 675B',        262144, 'nvidia'),
  makeModel('nvidia/llama-3.1-nemotron-ultra-253b-v1',           'Nemotron Ultra 253B',       131072, 'nvidia'),
  makeModel('qwen/qwq-32b',                                      'QwQ 32B',                   131072, 'nvidia'),

  // ── A tier ─────────────────────────────────────────────────────────────────
  makeModel('deepseek-ai/deepseek-r1-distill-qwen-32b',          'R1 Distill 32B',            131072, 'nvidia'),
  makeModel('openai/gpt-oss-20b',                                'GPT OSS 20B',               131072, 'nvidia'),
  makeModel('mistralai/mistral-medium-3-instruct',               'Mistral Medium 3',          131072, 'nvidia'),
  makeModel('mistralai/magistral-small-2506',                    'Magistral Small',           32768,  'nvidia'),
  makeModel('meta/llama-4-scout-17b-16e-instruct',               'Llama 4 Scout',             131072, 'nvidia'),
  makeModel('meta/llama-3.1-405b-instruct',                      'Llama 3.1 405B',            131072, 'nvidia'),
  makeModel('nvidia/nemotron-3-nano-30b-a3b',                    'Nemotron Nano 30B',         131072, 'nvidia'),
  makeModel('nvidia/nemotron-nano-3-30b-a3b',                    'Nemotron Nano 3 30B',       131072, 'nvidia'),
  makeModel('nvidia/llama-3.3-nemotron-super-49b-v1.5',          'Nemotron Super 49B v1.5',   131072, 'nvidia'),
  makeModel('nvidia/llama-3.3-nemotron-super-49b-v1',            'Nemotron Super 49B v1',     131072, 'nvidia'),
  makeModel('qwen/qwen2.5-coder-32b-instruct',                   'Qwen2.5 Coder 32B',        32768,  'nvidia'),
  makeModel('nvidia/nemotron-4-340b-instruct',                   'Nemotron 4 340B',           4096,   'nvidia'),
  makeModel('mistralai/mistral-large-2-instruct',                'Mistral Large 2',           131072, 'nvidia'),
  makeModel('mistralai/mistral-nemotron',                        'Mistral Nemotron',          131072, 'nvidia'),
  makeModel('igenius/colosseum_355b_instruct_16k',               'Colosseum 355B',            16384,  'nvidia'),

  // ── A- tier ────────────────────────────────────────────────────────────────
  makeModel('meta/llama-3.3-70b-instruct',                       'Llama 3.3 70B',             131072, 'nvidia'),
  makeModel('deepseek-ai/deepseek-r1-distill-qwen-14b',          'R1 Distill 14B',            65536,  'nvidia'),
  makeModel('bytedance/seed-oss-36b-instruct',                   'Seed OSS 36B',              32768,  'nvidia'),
  makeModel('stockmark/stockmark-2-100b-instruct',               'Stockmark 100B',            32768,  'nvidia'),
  makeModel('mistralai/mistral-large',                           'Mistral Large',             32768,  'nvidia'),
  makeModel('writer/palmyra-creative-122b',                      'Palmyra Creative 122B',     32768,  'nvidia'),
  makeModel('nvidia/llama-3.1-nemotron-70b-instruct',            'Nemotron 70B',              131072, 'nvidia'),
  makeModel('nvidia/llama-3.1-nemotron-51b-instruct',            'Nemotron 51B',              131072, 'nvidia'),
  makeModel('meta/llama-3.2-90b-vision-instruct',                'Llama 3.2 90B Vision',      131072, 'nvidia'),

  // ── B+ tier ────────────────────────────────────────────────────────────────
  makeModel('meta/llama-3.1-70b-instruct',                       'Llama 3.1 70B',             131072, 'nvidia'),
  makeModel('ibm/granite-34b-code-instruct',                     'Granite 34B Code',          32768,  'nvidia'),
  makeModel('mistralai/ministral-14b-instruct-2512',             'Ministral 14B',             32768,  'nvidia'),
  makeModel('mistralai/mixtral-8x22b-instruct-v0.1',             'Mixtral 8x22B',             65536,  'nvidia'),
  makeModel('mistralai/mistral-small-3.1-24b-instruct-2503',     'Mistral Small 3.1 24B',     131072, 'nvidia'),
  makeModel('01-ai/yi-large',                                    'Yi Large',                  32768,  'nvidia'),
  makeModel('abacusai/dracarys-llama-3.1-70b-instruct',          'Dracarys 70B',              131072, 'nvidia'),
  makeModel('meta/llama3-70b-instruct',                          'Llama 3 70B',               8192,   'nvidia'),
  makeModel('meta/codellama-70b',                                'Code Llama 70B',            4096,   'nvidia'),
  makeModel('nvidia/llama3-chatqa-1.5-70b',                      'ChatQA 1.5 70B',            131072, 'nvidia'),
  makeModel('nvidia/usdcode-llama-3.1-70b-instruct',             'USDCode 70B',               131072, 'nvidia'),
  makeModel('writer/palmyra-fin-70b-32k',                        'Palmyra Fin 70B',           32768,  'nvidia'),
  makeModel('writer/palmyra-med-70b',                            'Palmyra Med 70B',           32768,  'nvidia'),
  makeModel('writer/palmyra-med-70b-32k',                        'Palmyra Med 70B 32K',       32768,  'nvidia'),
  makeModel('institute-of-science-tokyo/llama-3.1-swallow-70b-instruct-v0.1', 'Swallow 70B',  131072, 'nvidia'),
  makeModel('tokyotech-llm/llama-3-swallow-70b-instruct-v0.1',  'Swallow 3 70B',             8192,   'nvidia'),
  makeModel('yentinglin/llama-3-taiwan-70b-instruct',            'Taiwan 70B',                8192,   'nvidia'),

  // ── B tier ─────────────────────────────────────────────────────────────────
  makeModel('deepseek-ai/deepseek-r1-distill-qwen-7b',           'R1 Distill 7B',             32768,  'nvidia'),
  makeModel('deepseek-ai/deepseek-r1-distill-llama-8b',          'R1 Distill 8B',             32768,  'nvidia'),
  makeModel('meta/llama-3.1-8b-instruct',                        'Llama 3.1 8B',              131072, 'nvidia'),
  makeModel('meta/llama2-70b',                                   'Llama 2 70B',               4096,   'nvidia'),
  makeModel('microsoft/phi-3-medium-128k-instruct',              'Phi 3 Medium 128K',         131072, 'nvidia'),
  makeModel('microsoft/phi-3-medium-4k-instruct',                'Phi 3 Medium 4K',           4096,   'nvidia'),
  makeModel('microsoft/phi-3-vision-128k-instruct',              'Phi 3 Vision',              131072, 'nvidia'),
  makeModel('microsoft/phi-3.5-moe-instruct',                    'Phi 3.5 MoE',               131072, 'nvidia'),
  makeModel('microsoft/phi-3.5-vision-instruct',                 'Phi 3.5 Vision',            131072, 'nvidia'),
  makeModel('microsoft/phi-4-mini-flash-reasoning',              'Phi 4 Mini Flash',          131072, 'nvidia'),
  makeModel('microsoft/phi-4-mini-instruct',                     'Phi-4 Mini',                131072, 'nvidia'),
  makeModel('microsoft/phi-4-multimodal-instruct',               'Phi 4 Multimodal',          131072, 'nvidia'),
  makeModel('mistralai/mistral-small-24b-instruct',              'Mistral Small 24B',         32768,  'nvidia'),
  makeModel('google/gemma-2-27b-it',                             'Gemma 2 27B',               8192,   'nvidia'),
  makeModel('google/gemma-2-9b-it',                              'Gemma 2 9B',                8192,   'nvidia'),
  makeModel('google/gemma-3-27b-it',                             'Gemma 3 27B',               32768,  'nvidia'),
  makeModel('google/gemma-3-12b-it',                             'Gemma 3 12B',               32768,  'nvidia'),
  makeModel('meta/llama-3.2-11b-vision-instruct',                'Llama 3.2 11B Vision',      131072, 'nvidia'),
  makeModel('nv-mistralai/mistral-nemo-12b-instruct',            'Mistral Nemo 12B',          131072, 'nvidia'),
  makeModel('nvidia/cosmos-reason2-8b',                          'Cosmos Reason2 8B',         131072, 'nvidia'),
  makeModel('nvidia/nemotron-nano-12b-v2-vl',                    'Nemotron Nano 12B VL',      131072, 'nvidia'),
  makeModel('nvidia/nvidia-nemotron-nano-9b-v2',                 'Nemotron Nano 9B v2',       131072, 'nvidia'),
  makeModel('deepseek-ai/deepseek-r1',                           'DeepSeek R1',               131072, 'nvidia'),
  makeModel('qwen/qwen2.5-72b-instruct',                         'Qwen2.5 72B',               131072, 'nvidia'),
  makeModel('microsoft/phi-4',                                   'Phi-4',                     16384,  'nvidia'),
  makeModel('qwen/qwen3-235b-a22b-instruct-fp8',                 'Qwen3 235B A22B FP8',       32768,  'nvidia'),
  makeModel('qwen/qwen3-32b-instruct',                           'Qwen3 32B',                 32768,  'nvidia'),
  makeModel('qwen/qwen3-30b-a3b-instruct',                       'Qwen3 30B A3B',             32768,  'nvidia'),
  makeModel('ibm/granite-3.3-8b-instruct',                       'Granite 3.3 8B',            131072, 'nvidia'),

  // ── C tier ─────────────────────────────────────────────────────────────────
  makeModel('microsoft/phi-3.5-mini-instruct',                   'Phi 3.5 Mini',              131072, 'nvidia'),
  makeModel('google/gemma-3-4b-it',                              'Gemma 3 4B',                32768,  'nvidia'),
  makeModel('google/gemma-3-1b-it',                              'Gemma 3 1B',                32768,  'nvidia'),
  makeModel('google/gemma-3n-e2b-it',                            'Gemma 3n 2B',               8192,   'nvidia'),
  makeModel('google/gemma-3n-e4b-it',                            'Gemma 3n 4B',               8192,   'nvidia'),
  makeModel('google/gemma-2-2b-it',                              'Gemma 2 2B',                8192,   'nvidia'),
  makeModel('microsoft/phi-3-small-128k-instruct',               'Phi 3 Small 128K',          131072, 'nvidia'),
  makeModel('microsoft/phi-3-small-8k-instruct',                 'Phi 3 Small 8K',            8192,   'nvidia'),
  makeModel('microsoft/phi-3-mini-128k-instruct',                'Phi 3 Mini 128K',           131072, 'nvidia'),
  makeModel('microsoft/phi-3-mini-4k-instruct',                  'Phi 3 Mini 4K',             4096,   'nvidia'),
  makeModel('mistralai/codestral-22b-instruct-v0.1',             'Codestral 22B',             32768,  'nvidia'),
  makeModel('mistralai/mistral-7b-instruct-v0.2',                'Mistral 7B v0.2',           32768,  'nvidia'),
  makeModel('mistralai/mistral-7b-instruct-v0.3',                'Mistral 7B v0.3',           32768,  'nvidia'),
  makeModel('mistralai/mixtral-8x7b-instruct-v0.1',              'Mixtral 8x7B',              32768,  'nvidia'),
  makeModel('mistralai/mamba-codestral-7b-v0.1',                 'Mamba Codestral 7B',        262144, 'nvidia'),
  makeModel('mistralai/mathstral-7b-v0.1',                       'Mathstral 7B',              32768,  'nvidia'),
  makeModel('databricks/dbrx-instruct',                          'DBRX Instruct',             32768,  'nvidia'),
  makeModel('ai21labs/jamba-1.5-large-instruct',                  'Jamba 1.5 Large',           262144, 'nvidia'),
  makeModel('ai21labs/jamba-1.5-mini-instruct',                   'Jamba 1.5 Mini',            262144, 'nvidia'),
  makeModel('meta/llama-3.2-3b-instruct',                        'Llama 3.2 3B',              131072, 'nvidia'),
  makeModel('meta/llama-3.2-1b-instruct',                        'Llama 3.2 1B',              131072, 'nvidia'),
  makeModel('meta/llama3-8b-instruct',                           'Llama 3 8B',                8192,   'nvidia'),
  makeModel('deepseek-ai/deepseek-coder-6.7b-instruct',          'DeepSeek Coder 6.7B',       16384,  'nvidia'),
  makeModel('google/codegemma-1.1-7b',                           'CodeGemma 7B',              8192,   'nvidia'),
  makeModel('nvidia/llama-3.1-nemotron-nano-4b-v1.1',            'Nemotron Nano 4B',          131072, 'nvidia'),
  makeModel('nvidia/llama-3.1-nemotron-nano-8b-v1',              'Nemotron Nano 8B',          131072, 'nvidia'),
  makeModel('nvidia/llama3-chatqa-1.5-8b',                       'ChatQA 1.5 8B',             8192,   'nvidia'),
  makeModel('nvidia/mistral-nemo-minitron-8b-8k-instruct',       'Minitron 8B',               8192,   'nvidia'),
  makeModel('nvidia/nemotron-mini-4b-instruct',                  'Nemotron Mini 4B',          4096,   'nvidia'),
  makeModel('nvidia/nemotron-4-mini-hindi-4b-instruct',          'Nemotron Hindi 4B',         4096,   'nvidia'),
  makeModel('ibm/granite-3.0-3b-a800m-instruct',                 'Granite 3.0 3B',            131072, 'nvidia'),
  makeModel('ibm/granite-3.0-8b-instruct',                       'Granite 3.0 8B',            131072, 'nvidia'),
  makeModel('ibm/granite-8b-code-instruct',                      'Granite 8B Code',           8192,   'nvidia'),
  makeModel('qwen/qwen2-7b-instruct',                            'Qwen2 7B',                  131072, 'nvidia'),
  makeModel('qwen/qwen2.5-7b-instruct',                          'Qwen2.5 7B',                131072, 'nvidia'),
  makeModel('qwen/qwen2.5-coder-7b-instruct',                    'Qwen2.5 Coder 7B',          32768,  'nvidia'),
  makeModel('igenius/italia_10b_instruct_16k',                    'Italia 10B',                16384,  'nvidia'),
  makeModel('baichuan-inc/baichuan2-13b-chat',                    'Baichuan2 13B',             4096,   'nvidia'),
  makeModel('aisingapore/sea-lion-7b-instruct',                   'SEA-LION 7B',               4096,   'nvidia'),
  makeModel('gotocompany/gemma-2-9b-cpt-sahabatai-instruct',     'Sahabat-AI 9B',             8192,   'nvidia'),
  makeModel('institute-of-science-tokyo/llama-3.1-swallow-8b-instruct-v0.1', 'Swallow 8B',    131072, 'nvidia'),
  makeModel('marin/marin-8b-instruct',                           'Marin 8B',                  131072, 'nvidia'),
  makeModel('mediatek/breeze-7b-instruct',                       'Breeze 7B',                 32768,  'nvidia'),
  makeModel('opengpt-x/teuken-7b-instruct-commercial-v0.4',      'Teuken 7B',                 8192,   'nvidia'),
  makeModel('rakuten/rakutenai-7b-chat',                          'RakutenAI 7B Chat',         4096,   'nvidia'),
  makeModel('rakuten/rakutenai-7b-instruct',                      'RakutenAI 7B',              4096,   'nvidia'),
  makeModel('sarvamai/sarvam-m',                                  'Sarvam M',                  8192,   'nvidia'),
  makeModel('speakleash/bielik-11b-v2.3-instruct',               'Bielik 11B v2.3',           8192,   'nvidia'),
  makeModel('speakleash/bielik-11b-v2.6-instruct',               'Bielik 11B v2.6',           8192,   'nvidia'),
  makeModel('thudm/chatglm3-6b',                                 'ChatGLM3 6B',               8192,   'nvidia'),
  makeModel('tiiuae/falcon3-7b-instruct',                        'Falcon3 7B',                8192,   'nvidia'),
  makeModel('upstage/solar-10.7b-instruct',                      'Solar 10.7B',               4096,   'nvidia'),
  makeModel('utter-project/eurollm-9b-instruct',                 'EuroLLM 9B',                8192,   'nvidia'),
  makeModel('zyphra/zamba2-7b-instruct',                          'Zamba2 7B',                 8192,   'nvidia'),
];

// ─── NVIDIA NIM dynamic fetch ─────────────────────────────────────────────────

function fetchNimModels(apiKey) {
  return new Promise((resolve) => {
    const opts = {
      hostname: 'integrate.api.nvidia.com',
      port:     443,
      path:     '/v1/models',
      method:   'GET',
      headers:  { 'User-Agent': 'frouter/1.0' },
    };
    if (apiKey) opts.headers['Authorization'] = `Bearer ${apiKey}`;

    const req = https.request(opts, (res) => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          const data = Array.isArray(json.data) ? json.data : (Array.isArray(json) ? json : []);
          const chatModels = data.filter(m => {
            const id = m.id || '';
            // Keep chat/instruct models, skip embedding/rerank/vlm-only
            if (/embed|rerank|reward/i.test(id)) return false;
            return true;
          });
          const result = chatModels.map(m => makeModel(
            m.id,
            m.id.split('/').pop().replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
            m.context_length || 32768,
            'nvidia'
          ));
          resolve(result.length > 0 ? result : null); // null = fall back to hardcoded
        } catch {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.setTimeout(15_000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// ─── OpenRouter dynamic fetch ─────────────────────────────────────────────────

function fetchOpenRouterModels(apiKey) {
  return new Promise((resolve) => {
    const opts = {
      hostname: 'openrouter.ai',
      port:     443,
      path:     '/api/v1/models',
      method:   'GET',
      headers:  { 'User-Agent': 'frouter/1.0' },
    };
    if (apiKey) opts.headers['Authorization'] = `Bearer ${apiKey}`;

    const req = https.request(opts, (res) => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          const data = Array.isArray(json.data) ? json.data : (Array.isArray(json) ? json : []);
          const free = data
            .filter(m => m?.pricing?.prompt === '0' && m?.pricing?.completion === '0')
            .map(m => makeModel(
              m.id,
              m.name || m.id,
              m.context_length || 32768,
              'openrouter'
            ));
          resolve(free);
        } catch {
          resolve([]);
        }
      });
    });

    req.on('error', () => resolve([]));
    req.setTimeout(15_000, () => { req.destroy(); resolve([]); });
    req.end();
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Return all models from all enabled providers.
 * NIM is hardcoded; OpenRouter is fetched live.
 * Each model has: id, displayName, context, providerKey, sweScore, tier,
 *                 pings:[], status:'pending', httpCode:null
 */
export async function getAllModels(config) {
  const results = [];

  if (config.providers?.nvidia?.enabled !== false) {
    const nvidiaKey = getApiKey(config, 'nvidia');
    let nimModels = null;
    if (nvidiaKey) {
      nimModels = await fetchNimModels(nvidiaKey);
    }
    const source = nimModels || NIM_MODELS;
    results.push(...source.map(m => ({ ...m, pings: [], status: 'pending', httpCode: null })));
  }

  if (config.providers?.openrouter?.enabled !== false) {
    const key = getApiKey(config, 'openrouter');
    const orModels = await fetchOpenRouterModels(key);
    results.push(...orModels);
  }

  return results;
}
