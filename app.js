/* ===================================================================
   AFOQT Study — app.js (vanilla, hash-routed, localStorage-backed)
   =================================================================== */

const STATE_KEY = "afoqt.state.v1";
const ANTHROPIC_KEY_KEY = "afoqt.anthropicKey";
const ANTHROPIC_MODEL = "claude-opus-4-6";
const GITHUB_PAT_KEY = "afoqt.githubPat";
const GITHUB_GIST_ID_KEY = "afoqt.githubGistId";
const GIST_FILENAME = "afoqt-state.json";
const SYNC_DEBOUNCE_MS = 20_000; // wait 20s after last change before pushing

const FOCUS = {
  0: 'Rest / Review',
  1: 'Vocabulary',
  2: 'Reading',
  3: 'Analogies',
  4: 'Grammar',
  5: 'Math',
  6: 'Mini-Drill'
};

/* ---------- UTIL ---------- */
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const isoToday = () => new Date().toISOString().slice(0,10);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };
const dayOfYear = (d=new Date()) => {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d - start) / 86400000);
};
const todayFocus = () => FOCUS[new Date().getDay()];
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[c]));

/* ---------- STATE ---------- */
function defaultState() {
  return {
    startDate: isoToday(),
    streakDays: 0,
    lastSessionDate: null,
    totalMinutes: 0,
    sessions: [],
    vocab: {},
    generated: {},          // { "YYYY-MM-DD": { drills, quote, rootWords[], generatedAt } }
    recentRoots: [],        // rolling list of last ~20 roots taught, to avoid repeats
    settings: { soundOn: true }
  };
}

let STATE = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return defaultState();
    return { ...defaultState(), ...JSON.parse(raw) };
  } catch (e) {
    console.warn("state load failed", e);
    return defaultState();
  }
}

let _saveTimer = null;
function saveState() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try {
      STATE.lastModifiedAt = new Date().toISOString();
      localStorage.setItem(STATE_KEY, JSON.stringify(STATE));
      scheduleCloudSync();
    } catch (e) { console.warn("state save failed", e); }
  }, 300);
}

/* ===================================================================
   GITHUB GIST CLOUD SYNC
   =================================================================== */

function githubPat() { return localStorage.getItem(GITHUB_PAT_KEY); }
function githubGistId() { return localStorage.getItem(GITHUB_GIST_ID_KEY); }

let _cloudSyncTimer = null;
let _cloudSyncInFlight = false;
let _cloudSyncStatus = { status: 'idle', at: null, message: '' };

function scheduleCloudSync() {
  if (!githubPat()) return;
  clearTimeout(_cloudSyncTimer);
  _cloudSyncTimer = setTimeout(() => { cloudSync('upload').catch(()=>{}); }, SYNC_DEBOUNCE_MS);
}

function emitSyncStatus(status, message) {
  _cloudSyncStatus = { status, at: new Date().toISOString(), message: message || '' };
  // Notify any open settings view
  window.dispatchEvent(new CustomEvent('afoqt:sync-status', { detail: _cloudSyncStatus }));
}

async function ghRequest(path, { method = "GET", body = null } = {}) {
  const pat = githubPat();
  if (!pat) throw new Error("No GitHub token.");
  const headers = {
    "Accept": "application/vnd.github+json",
    "Authorization": `Bearer ${pat}`,
    "X-GitHub-Api-Version": "2022-11-28"
  };
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(`https://api.github.com${path}`, { method, headers, body: body ? JSON.stringify(body) : null });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub ${res.status}: ${text.slice(0, 180)}`);
  }
  return res.json();
}

async function createPrivateGist(initialStateJson) {
  const body = {
    description: "AFOQT Study — backup of local progress (auto-synced)",
    public: false,
    files: { [GIST_FILENAME]: { content: initialStateJson } }
  };
  const created = await ghRequest("/gists", { method: "POST", body });
  localStorage.setItem(GITHUB_GIST_ID_KEY, created.id);
  return created;
}

async function cloudSync(direction = "auto") {
  if (_cloudSyncInFlight) return;
  if (!githubPat()) { emitSyncStatus('idle', 'No GitHub token'); return; }
  _cloudSyncInFlight = true;
  try {
    emitSyncStatus('syncing', direction);
    let gistId = githubGistId();

    if (direction === "upload" || !gistId) {
      // Create the gist if we don't have one yet.
      if (!gistId) {
        emitSyncStatus('syncing', 'creating private gist');
        const created = await createPrivateGist(JSON.stringify(STATE, null, 2));
        gistId = created.id;
        emitSyncStatus('synced', `created gist ${gistId.slice(0,7)}`);
        return;
      }
      // Otherwise PATCH existing.
      await ghRequest(`/gists/${encodeURIComponent(gistId)}`, {
        method: "PATCH",
        body: { files: { [GIST_FILENAME]: { content: JSON.stringify(STATE, null, 2) } } }
      });
      emitSyncStatus('synced', 'pushed to cloud');
      return;
    }

    if (direction === "download") {
      const remote = await ghRequest(`/gists/${encodeURIComponent(gistId)}`);
      const file = remote.files?.[GIST_FILENAME];
      if (!file?.content) throw new Error("No state file in gist.");
      const parsed = JSON.parse(file.content);
      STATE = { ...defaultState(), ...parsed };
      localStorage.setItem(STATE_KEY, JSON.stringify(STATE));
      emitSyncStatus('synced', 'pulled from cloud');
      return;
    }

    // 'auto': compare timestamps, pull if remote newer, push otherwise.
    const remote = await ghRequest(`/gists/${encodeURIComponent(gistId)}`);
    const file = remote.files?.[GIST_FILENAME];
    if (!file?.content) {
      // Gist exists but empty — push our state.
      await ghRequest(`/gists/${encodeURIComponent(gistId)}`, {
        method: "PATCH",
        body: { files: { [GIST_FILENAME]: { content: JSON.stringify(STATE, null, 2) } } }
      });
      emitSyncStatus('synced', 'pushed (remote was empty)');
      return;
    }
    const remoteState = JSON.parse(file.content);
    const remoteTs = remoteState.lastModifiedAt || remote.updated_at || '';
    const localTs  = STATE.lastModifiedAt || '';
    if (remoteTs && (!localTs || remoteTs > localTs)) {
      STATE = { ...defaultState(), ...remoteState };
      localStorage.setItem(STATE_KEY, JSON.stringify(STATE));
      emitSyncStatus('synced', 'pulled (remote was newer)');
    } else if (localTs && (!remoteTs || localTs > remoteTs)) {
      await ghRequest(`/gists/${encodeURIComponent(gistId)}`, {
        method: "PATCH",
        body: { files: { [GIST_FILENAME]: { content: JSON.stringify(STATE, null, 2) } } }
      });
      emitSyncStatus('synced', 'pushed (local was newer)');
    } else {
      emitSyncStatus('synced', 'already in sync');
    }
  } catch (e) {
    emitSyncStatus('error', (e.message || String(e)).slice(0, 160));
  } finally {
    _cloudSyncInFlight = false;
  }
}

/* ---------- STREAK ---------- */
// Called AFTER a session is logged. Pass the previous lastSessionDate explicitly.
function bumpStreak(prevLast, today) {
  if (prevLast === today) return; // already logged today, streak unchanged
  if (!prevLast) { STATE.streakDays = 1; return; }
  const yesterday = addDays(new Date(today), -1).toISOString().slice(0,10);
  if (prevLast === yesterday) STATE.streakDays += 1;
  else STATE.streakDays = 1;
}

function daysSinceStart() {
  if (!STATE.startDate) return 0;
  const s = new Date(STATE.startDate);
  const n = new Date(isoToday());
  return Math.max(0, Math.round((n - s) / 86400000));
}

/* ===================================================================
   DAILY CONTENT GENERATOR (Claude API)
   =================================================================== */

const DAILY_SCHEMA = {
  type: "object",
  properties: {
    quote: {
      type: "object",
      properties: {
        t: { type: "string", description: "The quote text" },
        a: { type: "string", description: "Attribution / author" }
      },
      required: ["t", "a"],
      additionalProperties: false
    },
    rootWords: {
      type: "array",
      description: "Exactly 5 Greek or Latin word roots for today's vocab lesson",
      items: {
        type: "object",
        properties: {
          root: { type: "string", description: "The root itself, e.g. 'chron' or 'bene'" },
          origin: { type: "string", description: "Language of origin, e.g. 'Greek' or 'Latin'" },
          meaning: { type: "string", description: "Short 1-4 word gloss used as a badge" },
          meaningFull: {
            type: "string",
            description: "A full 1-2 sentence definition explaining the semantic range of the root and what concepts it evokes."
          },
          etymology: {
            type: "string",
            description: "A 1-2 sentence origin story: the parent Greek/Latin word (include the original spelling in the script used if it's short and common, else transliterated), its literal original sense, and how it entered English."
          },
          mnemonic: {
            type: "string",
            description: "One short vivid sentence that uses a concrete image to burn the meaning into memory."
          },
          examples: {
            type: "array",
            description: "3-4 English words built from this root. For each, give the word and a concise 1-sentence meaning in plain English.",
            items: {
              type: "object",
              properties: {
                word: { type: "string" },
                meaning: { type: "string" }
              },
              required: ["word", "meaning"],
              additionalProperties: false
            },
            minItems: 3,
            maxItems: 4
          },
          usageNote: {
            type: "string",
            description: "One sentence tip: when you see this root pattern in an unfamiliar word, what should you infer? E.g. 'Any word containing \"chron\" relates to time, sequence, or duration.'"
          },
          svg: {
            type: "string",
            description: "A raw inline SVG icon that visually conveys the root's meaning. Must start with <svg and end with </svg>. Use viewBox='0 0 400 200'. Minimalist line-art style: thin strokes, single concept, no text, no script tags, no external references. Use currentColor for strokes so it picks up the card's theme color."
          }
        },
        required: ["root", "origin", "meaning", "meaningFull", "etymology", "mnemonic", "examples", "usageNote", "svg"],
        additionalProperties: false
      }
    },
    drills: {
      type: "array",
      description: "Five AFOQT-style practice questions",
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["word-knowledge", "analogy", "reading-comp", "math-reasoning", "math-knowledge"]
          },
          prompt: { type: "string" },
          choices: {
            type: "array",
            items: { type: "string" },
            minItems: 4,
            maxItems: 4
          },
          answerIdx: { type: "integer", minimum: 0, maximum: 3 },
          explanation: { type: "string" }
        },
        required: ["type", "prompt", "choices", "answerIdx", "explanation"],
        additionalProperties: false
      }
    }
  },
  required: ["quote", "rootWords", "drills"],
  additionalProperties: false
};

const DAILY_SYSTEM = `You are an expert AFOQT (Air Force Officer Qualifying Test) tutor generating daily practice content for a single candidate studying 20 minutes per day. Your drills must match the style, difficulty, and subtest format of the real AFOQT:

- word-knowledge: "Choose the word most similar in meaning to X" or "most opposite"
- analogy: "A is to B as C is to ___"
- reading-comp: Start with a 2-4 sentence passage, then a single-point comprehension question
- math-reasoning: Word problems (rate, ratio, percentage, distance)
- math-knowledge: Pure algebra, geometry, or arithmetic facts

Rules:
- Each drill must have exactly 4 choices. answerIdx is 0-indexed.
- Explanation must be one sentence, showing the reasoning or key fact.
- Quotes should be short (under 25 words), motivational, about discipline, persistence, or officership. Attribute accurately; if unsure, use "Unknown" or "Proverb".
- rootWords: exactly 5 Greek or Latin word roots that appear in AFOQT-tier English vocabulary. Prefer variety — mix Greek and Latin, mix "big" roots (many English derivatives) with less common ones. Avoid the "recent roots" list the user sends you.
- For each root, teach it thoroughly. You are writing a mini etymology lesson a student can actually learn from:
  * meaning: 1-4 word gloss (badge text)
  * meaningFull: 1-2 sentences explaining the full semantic range — not just the literal sense but what concepts it evokes. E.g. for 'chron' say "Relating to time, duration, or the ordering of events. Anything involving when, how long, or in what sequence something happens."
  * etymology: 1-2 sentences giving the parent Greek/Latin word (with original spelling if short), its literal ancient meaning, and how it came into English.
  * mnemonic: one short vivid sentence anchoring meaning to a concrete image.
  * examples: 3-4 English derivatives, each as {word, meaning} where meaning is a full plain-English definition (not just a gloss).
  * usageNote: one sentence telling the student what to infer when they see this root in an unfamiliar word on the test.
- svg: produce a minimalist inline SVG icon (viewBox="0 0 400 200"). Think bookplate or Noun Project icon: strong silhouette, thin consistent stroke weight (2-3px), single clear concept that represents the root's meaning. Rules — (1) MUST begin with <svg and end with </svg>. (2) Use stroke="currentColor" fill="none" on most elements so the icon inherits page color. (3) Use fill="currentColor" sparingly for solid accents. (4) No <script>, no <foreignObject>, no external <image href>, no <use xlink:href>. (5) No text elements — pure shapes. (6) Use stroke-linecap="round" stroke-linejoin="round" for a clean look. Examples of concept-to-icon mapping: chron (time) = hourglass or pocket watch circle with hands; bene (good) = open hand releasing a dove or sunburst; mal (bad) = dagger or lightning bolt; ject (throw) = catapult arc or curved arrow; scrib (write) = quill pen with scroll; tele (far) = telescope on tripod; aqua (water) = cresting wave; omni (all) = concentric circles or eye inside sunburst.
- Never reproduce copyrighted prep-book content verbatim. Write every drill fresh.`;

function anthropicKey() { return localStorage.getItem(ANTHROPIC_KEY_KEY); }

async function generateDailyContent({ force = false } = {}) {
  const key = anthropicKey();
  if (!key) throw new Error("No Anthropic API key. Add one in Settings.");

  const today = isoToday();
  STATE.generated = STATE.generated || {};
  if (!force && STATE.generated[today]) return STATE.generated[today];

  const recent = (STATE.recentRoots || []).slice(-20);
  const seedPool = (window.ROOTS || []).map(r => r.root).join(", ");
  const body = {
    model: ANTHROPIC_MODEL,
    max_tokens: 6000,
    system: DAILY_SYSTEM,
    messages: [{
      role: "user",
      content:
`Generate today's (${today}) AFOQT content.

Produce:
1. One short motivational quote.
2. Exactly 5 Greek/Latin root words for today's etymology lesson.
3. Exactly 5 drills spanning all five types (word-knowledge, analogy, reading-comp, math-reasoning, math-knowledge).

Candidate root pool (pick from here or propose your own if better): ${seedPool}.
Recently taught — do NOT repeat these: ${recent.length ? recent.join(", ") : "(none yet)"}.

For each root, write a concrete, photorealistic imagePrompt so a text-to-image model can produce an educational illustration that makes the meaning visually obvious.`
    }],
    output_config: {
      format: { type: "json_schema", schema: DAILY_SCHEMA }
    }
  };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Claude API ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const textBlock = (data.content || []).find(b => b.type === "text");
  if (!textBlock) throw new Error("Claude returned no text block.");

  let parsed;
  try { parsed = JSON.parse(textBlock.text); }
  catch (e) { throw new Error("Could not parse Claude's JSON: " + e.message); }

  const record = { ...parsed, generatedAt: new Date().toISOString() };
  STATE.generated[today] = record;

  // Track recently taught roots so tomorrow's prompt can avoid repeats.
  const todaysRoots = (parsed.rootWords || []).map(r => r.root);
  STATE.recentRoots = [...(STATE.recentRoots || []), ...todaysRoots].slice(-20);

  // Prune old entries: keep last 14 days.
  const keep = {};
  Object.keys(STATE.generated)
    .sort()
    .slice(-14)
    .forEach(k => { keep[k] = STATE.generated[k]; });
  STATE.generated = keep;

  saveState();
  return record;
}

function getTodayGenerated() {
  return STATE.generated?.[isoToday()] || null;
}

/* Sanitize an SVG string from the LLM before inserting into DOM.
   Strips <script>, event handlers, external references. Returns "" on bad input. */
function sanitizeSvg(raw) {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed.startsWith("<svg") || !trimmed.toLowerCase().endsWith("</svg>")) return "";
  let s = trimmed;
  // Strip <script>...</script>
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "");
  // Strip <foreignObject>...</foreignObject>
  s = s.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "");
  // Strip on*="..." event handlers
  s = s.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  // Strip external image/use references — anything with javascript:, data:text/html, or remote http hrefs
  s = s.replace(/\s+(href|xlink:href)\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*'|"https?:\/\/[^"]*"|'https?:\/\/[^']*')/gi, "");
  return s;
}

/* ===================================================================
   ONE-CLICK DEPLOY TO GITHUB PAGES
   Takes a repo-scoped PAT from the Settings form, creates the repo,
   uploads every static file via the Contents API, enables Pages.
   The PAT is never persisted — it lives only in the form field and
   is wiped when the deploy completes.
   =================================================================== */

const DEPLOY_FILES = [
  'index.html',
  'styles.css',
  'app.js',
  'favicon.svg',
  'README.md',
  'data/vocab.js',
  'data/quotes.js',
  'data/drills.js',
  'data/roots.js'
];

async function fetchFileAsBase64(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Could not read local ${path}: HTTP ${res.status}`);
  const text = await res.text();
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function runGitHubPagesDeploy({ pat, repoName, onLog }) {
  const log = onLog || (() => {});
  const headers = {
    Authorization: `Bearer ${pat}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };

  log('› Verifying token…');
  const uRes = await fetch('https://api.github.com/user', { headers });
  if (!uRes.ok) throw new Error(`Token invalid (${uRes.status}). The PAT needs 'public_repo' scope.`);
  const u = await uRes.json();
  const username = u.login;
  log(`✓ Authenticated as ${username}`);

  log(`› Creating repo ${username}/${repoName}…`);
  const crRes = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: repoName,
      description: 'AFOQT Study — personal study app',
      private: false,
      auto_init: true
    })
  });
  if (crRes.ok) {
    log('✓ Repo created');
    // Let GitHub materialize the default branch before pushing.
    await new Promise(r => setTimeout(r, 2500));
  } else if (crRes.status === 422) {
    // Repo already exists — continue to upload/update files.
    log('↻ Repo already exists, will update files in place');
  } else {
    const body = await crRes.text();
    throw new Error(`Create repo ${crRes.status}: ${body.slice(0, 180)}`);
  }

  for (let i = 0; i < DEPLOY_FILES.length; i++) {
    const path = DEPLOY_FILES[i];
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const contentsUrl = `https://api.github.com/repos/${username}/${repoName}/contents/${encodedPath}`;

    // Check if the file already exists — if so, we must include its sha on PUT.
    let existingSha = null;
    const existRes = await fetch(`${contentsUrl}?ref=main`, { headers });
    if (existRes.status === 200) {
      const j = await existRes.json();
      existingSha = j.sha;
    } else if (existRes.status !== 404) {
      const body = await existRes.text();
      throw new Error(`Check ${path} ${existRes.status}: ${body.slice(0, 180)}`);
    }

    log(`› ${i + 1}/${DEPLOY_FILES.length}: ${existingSha ? 'updating' : 'uploading'} ${path}…`);
    const b64 = await fetchFileAsBase64(path);
    const putBody = {
      message: existingSha ? `Update ${path}` : `Add ${path}`,
      content: b64,
      branch: 'main'
    };
    if (existingSha) putBody.sha = existingSha;

    const pRes = await fetch(contentsUrl, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(putBody)
    });
    if (!pRes.ok) {
      const body = await pRes.text();
      throw new Error(`Upload ${path} ${pRes.status}: ${body.slice(0, 180)}`);
    }
  }
  log(`✓ All ${DEPLOY_FILES.length} files uploaded`);

  log('› Enabling GitHub Pages…');
  const pgRes = await fetch(`https://api.github.com/repos/${username}/${repoName}/pages`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: { branch: 'main', path: '/' } })
  });
  if (!pgRes.ok && pgRes.status !== 409) {
    const body = await pgRes.text();
    throw new Error(`Enable Pages ${pgRes.status}: ${body.slice(0, 180)}`);
  }
  log('✓ Pages enabled — GitHub usually takes 30–90 seconds to go live');
  const url = `https://${username}.github.io/${repoName}/`;
  return { username, repoName, url };
}

/* ---------- ROUTER ---------- */
const ROUTES = {
  home: renderHome,
  session: renderSession,
  vocab: renderVocab,
  drill: renderDrill,
  log: renderLog,
  review: renderReview,
  settings: renderSettings
};

function router() {
  let h = (location.hash || "#home").slice(1);
  if (!ROUTES[h]) h = "home";
  cleanupPage();
  const app = $("#app");
  app.innerHTML = '<div class="page"></div>';
  ROUTES[h]($(".page", app));
}

let _pageCleanup = null;
function onPageTeardown(fn) { _pageCleanup = fn; }
function cleanupPage() {
  if (typeof _pageCleanup === "function") { try { _pageCleanup(); } catch {} }
  _pageCleanup = null;
}

window.addEventListener("hashchange", router);
window.addEventListener("DOMContentLoaded", async () => {
  router();
  // Attempt a bidirectional cloud sync on load (non-blocking).
  if (githubPat() && githubGistId()) {
    try {
      await cloudSync('auto');
      // Re-render if state changed during the pull.
      router();
    } catch {}
  }
});

/* ===================================================================
   HOME
   =================================================================== */
function renderHome(root) {
  const d = dayOfYear();
  const todayGen = getTodayGenerated();
  const quote = todayGen?.quote || window.QUOTES[d % window.QUOTES.length];
  const focus = todayFocus();
  const days = daysSinceStart();
  const pct = Math.min(100, Math.round((days / 180) * 100));
  const today = isoToday();
  const todayDow = new Date().getDay();

  const dows = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const weekStart = addDays(new Date(today), -((todayDow + 6) % 7)); // Monday start
  const weekDots = [];
  for (let i = 0; i < 7; i++) {
    const d_ = addDays(weekStart, i).toISOString().slice(0,10);
    const hasSession = STATE.sessions.some(s => s.date === d_);
    const isToday = d_ === today;
    weekDots.push({ day: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][i], iso: d_, filled: hasSession, isToday });
  }

  root.innerHTML = `
    <section class="streak-hero">
      <div class="streak-number" aria-live="polite">${STATE.streakDays}</div>
      <div class="streak-label">day streak</div>
    </section>

    <div id="dailyBanner"></div>

    <div class="progress-wrap">
      <div class="progress-header">
        <div class="progress-label">Journey to AFOQT</div>
        <div class="progress-meta">Day ${days} of 180</div>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width: ${pct}%"></div></div>
    </div>

    <div class="weekly-dots">
      ${weekDots.map(x => `
        <div class="dot-wrap">
          <div class="dot-day">${x.day}</div>
          <div class="dot ${x.filled ? 'filled' : ''} ${x.isToday && !x.filled ? 'today' : ''}">
            ${x.filled ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
          </div>
        </div>
      `).join('')}
    </div>

    <div class="focus-card">
      <div class="focus-meta">${new Date().toLocaleDateString('en-US',{weekday:'long'})} — Today's Focus</div>
      <div class="focus-title">${esc(focus)}</div>
      <div class="focus-sub">${focusSub(focus)}</div>
    </div>

    <div class="cta-wrap">
      <button class="btn btn-primary-lg" id="startSessionBtn">Start 20-min Session</button>
      <div class="cta-note">Timer starts immediately. Hard cap at 20 minutes.</div>
    </div>

    <div id="rootsMount"></div>

    <div class="quote-card">
      <div class="quote-mark">&ldquo;</div>
      <div class="quote-text">${esc(quote.t)}</div>
      <div class="quote-attribution">${esc(quote.a)}</div>
    </div>

    <div class="quick-links">
      <a class="quick-link" href="#vocab"><div class="quick-link-icon">&#128218;</div><div class="quick-link-label">Study Vocab</div></a>
      <a class="quick-link" href="#drill"><div class="quick-link-icon">&#127919;</div><div class="quick-link-label">Mini-Drill</div></a>
      <a class="quick-link" href="#review"><div class="quick-link-icon">&#128221;</div><div class="quick-link-label">Weekly Review</div></a>
    </div>
  `;

  $("#startSessionBtn").addEventListener("click", () => location.hash = "#session");
  renderRootsOfDay($("#rootsMount"));
  renderDailyBanner($("#dailyBanner"));
}

/* ---------- ROOT WORDS OF THE DAY ---------- */
function renderRootsOfDay(mount) {
  if (!mount) return;
  const gen = getTodayGenerated();
  const roots = gen?.rootWords;

  if (!roots || roots.length === 0) {
    // Fallback: pick 5 seed roots deterministically from dayOfYear.
    const base = window.ROOTS || [];
    if (base.length === 0) { mount.innerHTML = ''; return; }
    const start = (dayOfYear() * 5) % base.length;
    const picked = [];
    for (let i = 0; i < 5; i++) picked.push(base[(start + i) % base.length]);
    mount.innerHTML = `
      <h2 class="type-h2" style="margin: 32px 0 12px;">Today's Roots</h2>
      <div class="type-small" style="margin-bottom: 16px;">Seed roots shown. Add an Anthropic key in Settings for fresh daily roots with custom SVG icons.</div>
      ${picked.map(r => renderRootCard(r)).join('')}
    `;
    return;
  }

  mount.innerHTML = `
    <h2 class="type-h2" style="margin: 32px 0 12px;">Today's Roots</h2>
    <div id="rootsList">${roots.map(renderRootCard).join('')}</div>
  `;
}

function renderRootCard(r) {
  const svg = sanitizeSvg(r.svg || '');
  const hasSvg = !!svg;
  // Examples may be legacy strings OR new {word, meaning} objects — normalize.
  const examples = (r.examples || []).map(e =>
    typeof e === 'string' ? { word: e, meaning: '' } : (e || {})
  );

  return `
    <div class="root-card">
      <div class="root-image ${hasSvg ? 'has-svg' : ''}">
        ${hasSvg ? `<div class="root-svg-wrap">${svg}</div>` : `<div class="root-image-placeholder">${esc((r.root || '?')[0].toUpperCase())}</div>`}
      </div>
      <div class="root-body">
        <div class="root-head">
          <div class="root-word">${esc(r.root)}<span class="root-dash">-</span></div>
          <div class="root-origin">${esc(r.origin)} &middot; ${esc(r.meaning)}</div>
        </div>

        ${r.meaningFull ? `
          <div class="root-section">
            <div class="root-section-label">Meaning</div>
            <div class="root-section-body">${esc(r.meaningFull)}</div>
          </div>` : ''}

        ${r.etymology ? `
          <div class="root-section">
            <div class="root-section-label">Origin</div>
            <div class="root-section-body">${esc(r.etymology)}</div>
          </div>` : ''}

        ${r.mnemonic ? `<div class="root-mnemonic">&ldquo;${esc(r.mnemonic)}&rdquo;</div>` : ''}

        ${examples.length ? `
          <div class="root-section">
            <div class="root-section-label">Words built from this root</div>
            <ul class="root-examples-list">
              ${examples.map(e => `
                <li>
                  <span class="root-example-word">${esc(e.word)}</span>${e.meaning ? ` <span class="root-example-sep">—</span> <span class="root-example-meaning">${esc(e.meaning)}</span>` : ''}
                </li>
              `).join('')}
            </ul>
          </div>` : ''}

        ${r.usageNote ? `
          <div class="root-usage">
            <span class="root-usage-label">Spot it:</span> ${esc(r.usageNote)}
          </div>` : ''}
      </div>
    </div>
  `;
}

/* ---------- DAILY CONTENT BANNER ---------- */
function renderDailyBanner(mount) {
  if (!mount) return;
  const hasKey = !!anthropicKey();
  const todayGen = getTodayGenerated();

  function paint(state) {
    // state: 'idle' | 'loading' | 'ready' | 'error' | 'no-key'
    if (state === 'no-key') {
      mount.innerHTML = `
        <div class="banner banner-info" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
          <span>Daily AI-generated drills are off. Add your Anthropic API key in <a href="#settings" style="color:var(--gold-dark);text-decoration:underline;">Settings</a> to enable.</span>
        </div>`;
      return;
    }
    if (state === 'loading') {
      mount.innerHTML = `<div class="banner banner-info">Generating today's fresh drills…</div>`;
      return;
    }
    if (state === 'ready') {
      const gen = getTodayGenerated();
      const nDrills = gen?.drills?.length || 0;
      const nRoots = gen?.rootWords?.length || 0;
      mount.innerHTML = `
        <div class="banner banner-info" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
          <span>Today's ready: ${nRoots} roots &middot; ${nDrills} drills. <a href="#drill" style="color:var(--gold-dark);text-decoration:underline;">Start mini-drill →</a></span>
          <button class="btn btn-ghost" id="regenBtn" style="padding:6px 14px;font-size:13px;">Regenerate</button>
        </div>`;
      $("#regenBtn")?.addEventListener("click", () => run(true));
      return;
    }
    if (state === 'error') {
      mount.innerHTML = `
        <div class="banner banner-info" style="border-left:3px solid var(--danger);display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
          <span>Couldn't generate today's drills. ${esc(mount.dataset.err || '')}</span>
          <button class="btn btn-ghost" id="retryBtn" style="padding:6px 14px;font-size:13px;">Retry</button>
        </div>`;
      $("#retryBtn")?.addEventListener("click", () => run(true));
      return;
    }
    mount.innerHTML = '';
  }

  async function run(force) {
    if (!anthropicKey()) { paint('no-key'); return; }
    paint('loading');
    try {
      await generateDailyContent({ force });
      paint('ready');
      const rMount = $("#rootsMount");
      if (rMount) renderRootsOfDay(rMount);
    } catch (e) {
      mount.dataset.err = e.message || String(e);
      paint('error');
    }
  }

  if (todayGen) { paint('ready'); return; }
  if (!hasKey) { paint('no-key'); return; }
  run(false);
}

function focusSub(focus) {
  const map = {
    'Vocabulary': 'Twenty cards. No more.',
    'Reading': 'One passage. Slow and close.',
    'Analogies': 'Pattern first, answer second.',
    'Grammar': 'Prepositions and articles — your weak spot.',
    'Math': 'Arithmetic, algebra, geometry.',
    'Mini-Drill': 'Mixed questions under pressure.',
    'Rest / Review': 'Review the week. Rest counts.'
  };
  return map[focus] || '';
}


/* ===================================================================
   SESSION (timer)
   =================================================================== */
function renderSession(root) {
  const focus = todayFocus();
  const TOTAL = 20 * 60;
  const R = 130;
  const C = 2 * Math.PI * R;

  root.innerHTML = `
    <div class="card">
      <div class="timer-wrap">
        <div class="timer-focus">${new Date().toLocaleDateString('en-US',{weekday:'long'})} — ${esc(focus)}</div>
        <div class="timer-svg" id="tsvg">
          <svg width="280" height="280" viewBox="0 0 280 280">
            <circle class="timer-ring-bg" cx="140" cy="140" r="${R}"/>
            <circle class="timer-ring-fg" cx="140" cy="140" r="${R}"
                    stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="0" id="tfg"/>
          </svg>
          <div class="timer-display" id="tdisp" aria-live="polite">20:00</div>
        </div>
        <div class="timer-meta">Hard cap at 20:00. The system does the work.</div>
        <div class="timer-controls">
          <button class="btn btn-gold"  id="tpause">Pause</button>
          <button class="btn btn-ghost" id="tcancel">Cancel</button>
        </div>
      </div>
    </div>
  `;

  let start = performance.now();
  let elapsed = 0;
  let paused = false;
  let pauseAt = 0;
  let raf = 0;
  let ended = false;

  const disp = $("#tdisp");
  const fg = $("#tfg");
  const pauseBtn = $("#tpause");

  function tick(now) {
    if (!paused && !ended) {
      const sec = Math.min(TOTAL, (now - start) / 1000 + elapsed);
      const remaining = Math.max(0, TOTAL - sec);
      const mm = Math.floor(remaining / 60).toString().padStart(2, '0');
      const ss = Math.floor(remaining % 60).toString().padStart(2, '0');
      disp.textContent = `${mm}:${ss}`;
      const offset = C * (sec / TOTAL);
      fg.setAttribute("stroke-dashoffset", offset.toFixed(2));
      if (remaining <= 0) { endSession(); return; }
    }
    raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);

  function endSession() {
    if (ended) return;
    ended = true;
    cancelAnimationFrame(raf);
    const svg = $("#tsvg");
    if (svg) svg.classList.add("chime");
    playChime();
    setTimeout(() => {
      sessionStorage.setItem("afoqt.pendingLog", JSON.stringify({ focus, minutes: 20 }));
      location.hash = "#log";
    }, 900);
  }

  pauseBtn.addEventListener("click", () => {
    if (ended) return;
    if (!paused) {
      paused = true;
      elapsed += (performance.now() - start) / 1000;
      pauseAt = performance.now();
      pauseBtn.textContent = "Resume";
    } else {
      paused = false;
      start = performance.now();
      pauseBtn.textContent = "Pause";
    }
  });

  $("#tcancel").addEventListener("click", () => {
    if (confirm("Cancel this session? Progress will not be saved.")) {
      cancelAnimationFrame(raf);
      ended = true;
      location.hash = "#home";
    }
  });

  const onKey = (e) => {
    if (e.code === "Space") { e.preventDefault(); pauseBtn.click(); }
    if (e.code === "Escape") { $("#tcancel").click(); }
  };
  window.addEventListener("keydown", onKey);

  onPageTeardown(() => {
    cancelAnimationFrame(raf);
    window.removeEventListener("keydown", onKey);
  });
}

function playChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 440;
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.8);
  } catch (e) { /* ignore */ }
}

/* ===================================================================
   VOCAB REVIEW (SM-2 Lite)
   =================================================================== */
function getDueCards() {
  const today = isoToday();
  seedVocabQueueIfEmpty();
  return Object.entries(STATE.vocab)
    .filter(([w, c]) => c.due <= today)
    .sort((a, b) => a[1].due.localeCompare(b[1].due))
    .slice(0, 20)
    .map(([w, c]) => ({ w, c, entry: window.VOCAB.find(v => v.w === w) }))
    .filter(x => x.entry);
}

function seedVocabQueueIfEmpty() {
  if (Object.keys(STATE.vocab).length > 0) return;
  // seed 10 cards due today
  const today = isoToday();
  window.VOCAB.slice(0, 10).forEach(v => {
    STATE.vocab[v.w] = { ease: 2.5, interval: 1, due: today, reps: 0, lapses: 0 };
  });
  saveState();
}

function nextReview(card, quality) {
  let { ease, interval, reps, lapses } = card;
  if (quality === 0) {
    lapses += 1;
    interval = 1;
    ease = Math.max(1.3, ease - 0.2);
    reps = 0;
  } else {
    if (reps === 0) interval = 1;
    else if (reps === 1) interval = 4;
    else interval = Math.round(interval * ease);
    if (quality === 1) ease = Math.max(1.3, ease - 0.15);
    if (quality === 3) ease = ease + 0.15;
    reps += 1;
  }
  const due = addDays(new Date(), interval).toISOString().slice(0, 10);
  return { ease, interval, reps, lapses, due };
}

function renderVocab(root) {
  const queue = getDueCards();
  if (queue.length === 0) {
    root.innerHTML = `
      <div class="banner banner-info">No vocab due today. Come back tomorrow — or add more words from the Word of the Day card.</div>
      <div class="cta-wrap"><button class="btn btn-ghost" onclick="location.hash='#home'">Back to home</button></div>
    `;
    return;
  }
  let idx = 0;
  let flipped = false;

  function draw() {
    if (idx >= queue.length) {
      root.innerHTML = `
        <div class="card" style="text-align:center;">
          <h2 class="type-h2" style="margin-bottom: 12px;">Session complete</h2>
          <p class="type-small" style="margin-bottom: 20px;">${queue.length} cards reviewed.</p>
          <button class="btn btn-primary" onclick="location.hash='#home'">Back to home</button>
        </div>
      `;
      return;
    }
    const { w, entry } = queue[idx];
    flipped = false;
    root.innerHTML = `
      <div class="drill-meta-row">
        <div class="type-meta">Vocabulary</div>
        <div class="drill-counter">Card ${idx + 1} of ${queue.length}</div>
      </div>
      <div class="flashcard" id="fc" tabindex="0" role="button" aria-label="Flashcard, click or press space to reveal">
        <div class="flashcard-inner">
          <div class="flashcard-face">
            <div class="flashcard-front-word">${esc(w)}</div>
            <div class="flashcard-front-hint">click to reveal &middot; space</div>
          </div>
          <div class="flashcard-face flashcard-back">
            <div class="fc-word-small">${esc(w)}</div>
            <div class="fc-pos">${esc(entry.p)}</div>
            <div class="fc-def">${esc(entry.d[0].toUpperCase()+entry.d.slice(1))}.</div>
            <div class="fc-ex">&ldquo;${esc(entry.e)}&rdquo;</div>
            <div class="srs-buttons">
              <button class="srs-btn srs-again" data-q="0">Again<span class="key">1</span></button>
              <button class="srs-btn srs-hard"  data-q="1">Hard<span class="key">2</span></button>
              <button class="srs-btn srs-good"  data-q="2">Good<span class="key">3</span></button>
              <button class="srs-btn srs-easy"  data-q="3">Easy<span class="key">4</span></button>
            </div>
          </div>
        </div>
      </div>
    `;
    const fc = $("#fc");
    fc.focus();
    fc.addEventListener("click", flip);
    $$(".srs-btn").forEach(b => b.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!flipped) return;
      rate(+b.dataset.q);
    }));
  }

  function flip() {
    const fc = $("#fc");
    if (!fc) return;
    flipped = !flipped;
    fc.classList.toggle("flipped", flipped);
  }

  function rate(q) {
    const { w, c } = queue[idx];
    STATE.vocab[w] = nextReview(c, q);
    saveState();
    idx++;
    draw();
  }

  const onKey = (e) => {
    if (e.code === "Space" || e.code === "Enter") {
      e.preventDefault();
      flip();
    }
    if (flipped && ["1","2","3","4"].includes(e.key)) {
      rate(parseInt(e.key, 10) - 1);
    }
  };
  window.addEventListener("keydown", onKey);
  onPageTeardown(() => window.removeEventListener("keydown", onKey));

  draw();
}

/* ===================================================================
   DRILL
   =================================================================== */
function renderDrill(root) {
  const todayGen = getTodayGenerated();
  const generatedPool = todayGen?.drills || [];
  const seedPool = window.DRILLS;
  const usingGenerated = generatedPool.length > 0;
  const pool = usingGenerated ? generatedPool : seedPool;
  const q = pool[Math.floor(Math.random() * pool.length)];
  let answered = false;
  let selected = -1;

  function draw() {
    root.innerHTML = `
      <div class="card">
        <div class="drill-meta-row">
          <div class="drill-counter">Mini-Drill${usingGenerated ? ' · today' : ''}</div>
          <div class="drill-counter">${esc(q.type.replace('-', ' '))}</div>
        </div>
        <div class="drill-type">${esc(q.type.replace('-', ' '))}</div>
        <div class="drill-prompt">${esc(q.prompt)}</div>
        <div class="drill-choices" id="choices">
          ${q.choices.map((ch, i) => `
            <button class="drill-choice" data-i="${i}">
              <span class="letter">${String.fromCharCode(65+i)}</span>
              <span>${esc(ch)}</span>
            </button>
          `).join('')}
        </div>
        <div id="explainMount"></div>
        <div class="drill-actions">
          <button class="btn btn-ghost" id="nextBtn">Next</button>
          <button class="btn btn-primary" id="submitBtn" disabled>Submit answer</button>
        </div>
      </div>
    `;

    $$(".drill-choice").forEach(btn => btn.addEventListener("click", () => {
      if (answered) return;
      selected = +btn.dataset.i;
      $$(".drill-choice").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      $("#submitBtn").disabled = false;
    }));

    $("#submitBtn").addEventListener("click", () => {
      if (answered || selected < 0) return;
      answered = true;
      $$(".drill-choice").forEach((b, i) => {
        if (i === q.answerIdx) b.classList.add("correct");
        else if (i === selected) b.classList.add("wrong");
        b.disabled = true;
      });
      $("#explainMount").innerHTML = `<div class="drill-explain">${esc(q.explanation)}</div>`;
      $("#submitBtn").style.display = "none";
    });

    $("#nextBtn").addEventListener("click", () => renderDrill(root));
  }

  draw();
}

/* ===================================================================
   LOG
   =================================================================== */
function renderLog(root) {
  const pending = JSON.parse(sessionStorage.getItem("afoqt.pendingLog") || "null");
  sessionStorage.removeItem("afoqt.pendingLog");
  const prefilledFocus = pending ? pending.focus : todayFocus();
  const prefilledMins = pending ? pending.minutes : 20;

  const focusOpts = ['Vocabulary','Reading','Analogies','Grammar','Math','Mini-Drill','Rest / Review'];

  root.innerHTML = `
    <div class="card">
      <div style="font-family: var(--font-serif); font-size: 24px; font-weight: 600; margin-bottom: 24px;">Log today's session</div>

      <div class="form-field">
        <label class="form-label" for="f-date">Date</label>
        <input id="f-date" type="date" class="form-input" value="${isoToday()}">
      </div>

      <div class="form-field">
        <label class="form-label" for="f-focus">Focus</label>
        <select id="f-focus" class="form-select">
          ${focusOpts.map(o => `<option ${o===prefilledFocus?'selected':''}>${esc(o)}</option>`).join('')}
        </select>
      </div>

      <div class="form-field">
        <label class="form-label" for="f-mins">Minutes</label>
        <input id="f-mins" type="number" min="1" max="240" class="form-input" value="${prefilledMins}">
      </div>

      <div class="form-field">
        <label class="form-label" for="f-rating">How did it feel? (1&ndash;10) — <span id="f-rating-val">7</span></label>
        <div class="slider-wrap">
          <input id="f-rating" type="range" class="slider" min="1" max="10" value="7">
          <div class="slider-labels">
            <span>Tough</span>
            <span>Solid</span>
            <span>Flow state</span>
          </div>
        </div>
      </div>

      <div class="form-field">
        <label class="form-label" for="f-note">One-line note</label>
        <textarea id="f-note" class="form-textarea" placeholder="What clicked, what didn't..."></textarea>
      </div>

      <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px;">
        <button class="btn btn-ghost" id="cancelBtn">Cancel</button>
        <button class="btn btn-primary" id="saveBtn">Save session</button>
      </div>
    </div>
  `;

  $("#f-rating").addEventListener("input", (e) => $("#f-rating-val").textContent = e.target.value);
  $("#cancelBtn").addEventListener("click", () => location.hash = "#home");
  $("#saveBtn").addEventListener("click", () => {
    const entry = {
      date: $("#f-date").value,
      focus: $("#f-focus").value,
      minutes: parseInt($("#f-mins").value, 10) || 0,
      rating: parseInt($("#f-rating").value, 10),
      note: $("#f-note").value.trim()
    };
    const prevLast = STATE.lastSessionDate;
    STATE.sessions.push(entry);
    STATE.totalMinutes += entry.minutes;
    bumpStreak(prevLast, entry.date);
    STATE.lastSessionDate = entry.date;
    saveState();
    location.hash = "#home";
  });
}

/* ===================================================================
   WEEKLY REVIEW
   =================================================================== */
function renderReview(root) {
  const today = isoToday();
  const start = addDays(new Date(today), -6).toISOString().slice(0,10);
  const recent = STATE.sessions.filter(s => s.date >= start && s.date <= today);
  const mins = recent.reduce((a,s) => a + (s.minutes||0), 0);
  const avg = recent.length ? (recent.reduce((a,s)=>a+s.rating,0)/recent.length).toFixed(1) : "—";

  // gap detection — focuses not touched in the last 7 days
  const touched = new Set(recent.map(s => s.focus));
  const allFocuses = ['Vocabulary','Reading','Analogies','Grammar','Math','Mini-Drill'];
  const gaps = allFocuses.filter(f => !touched.has(f));

  root.innerHTML = `
    <div class="card">
      <h1 class="type-h1" style="margin-bottom: 20px;">Weekly Review</h1>
      <div class="review-stat"><div class="review-stat-label">Sessions this week</div><div class="review-stat-value">${recent.length}</div></div>
      <div class="review-stat"><div class="review-stat-label">Total minutes</div><div class="review-stat-value">${mins}</div></div>
      <div class="review-stat"><div class="review-stat-label">Average rating</div><div class="review-stat-value">${avg}</div></div>
      <div class="review-stat"><div class="review-stat-label">Current streak</div><div class="review-stat-value">${STATE.streakDays}</div></div>
    </div>

    ${gaps.length ? `
    <div class="card" style="margin-top: 20px;">
      <h2 class="type-h2" style="margin-bottom: 12px;">Gaps — untouched this week</h2>
      <div class="type-small">${gaps.map(esc).join(' &middot; ')}</div>
    </div>` : ''}

    <div class="card" style="margin-top: 20px;">
      <h2 class="type-h2" style="margin-bottom: 16px;">Last 7 days</h2>
      ${recent.length === 0
        ? '<div class="type-small">No sessions logged this week yet.</div>'
        : recent.slice().reverse().map(s => `
          <div class="log-row">
            <div class="log-date">${esc(s.date)}</div>
            <div class="log-focus">${esc(s.focus)}</div>
            <div class="log-mins">${s.minutes}m</div>
            <div class="log-rating">${s.rating}/10</div>
          </div>
        `).join('')
      }
    </div>

    <div class="cta-wrap"><button class="btn btn-ghost" onclick="location.hash='#home'">Back to home</button></div>
  `;
}

/* ===================================================================
   SETTINGS
   =================================================================== */
function renderSettings(root) {
  const anthKey = localStorage.getItem(ANTHROPIC_KEY_KEY) || "";
  const ghPat   = localStorage.getItem(GITHUB_PAT_KEY) || "";
  const gistId  = localStorage.getItem(GITHUB_GIST_ID_KEY) || "";
  const mask = k => k ? `${k.slice(0, 6)}${'•'.repeat(Math.max(0, k.length - 10))}${k.slice(-4)}` : '';
  root.innerHTML = `
    <div class="card">
      <h1 class="type-h1" style="margin-bottom: 16px;">Settings</h1>

      <div class="form-field">
        <label class="form-label" for="anthKey">Anthropic API key
          ${anthKey ? `<span class="saved-tag">&#10003; saved: ${esc(mask(anthKey))}</span>` : ''}
        </label>
        <input id="anthKey" class="form-input" value="${esc(anthKey)}" placeholder="sk-ant-..." type="password" autocomplete="off">
        <div class="type-small" style="margin-top: 6px;">Generates today's roots, drills and quote via ${esc(ANTHROPIC_MODEL)} once per day. Stored only in this browser.</div>
      </div>

      <div style="display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 24px;">
        <button class="btn btn-primary" id="saveAnth">Save Anthropic key</button>
        <button class="btn btn-ghost"   id="clearAnth">Clear</button>
        <button class="btn btn-gold"    id="regenToday">Regenerate today</button>
      </div>
    </div>

    <div class="card" style="margin-top: 20px;">
      <h2 class="type-h2" style="margin-bottom: 12px;">Cloud sync (private GitHub Gist)</h2>
      <p class="type-small" style="margin-bottom: 16px;">
        Auto-backs up your progress to a private GitHub Gist every ~20 seconds after a change, and on page load.
        Works across devices: same token + same gist ID = same progress everywhere.
      </p>

      <div class="form-field">
        <label class="form-label" for="ghPat">GitHub Personal Access Token
          ${ghPat ? `<span class="saved-tag">&#10003; saved: ${esc(mask(ghPat))}</span>` : ''}
        </label>
        <input id="ghPat" class="form-input" value="${esc(ghPat)}" placeholder="github_pat_... or ghp_..." type="password" autocomplete="off">
        <div class="type-small" style="margin-top: 6px;">
          Create one at <span class="type-mono">github.com/settings/tokens</span> with scope <strong>gist</strong> only.
          Fine-grained (<span class="type-mono">github_pat_...</span>) or classic (<span class="type-mono">ghp_...</span>) both work.
        </div>
      </div>

      <div class="form-field">
        <label class="form-label" for="gistId">Gist ID
          ${gistId ? `<span class="saved-tag">&#10003; ${esc(gistId.slice(0,12))}…</span>` : '<span class="saved-tag" style="background:rgba(139,134,123,0.15); color:var(--text-faint);">auto-created on first sync</span>'}
        </label>
        <input id="gistId" class="form-input" value="${esc(gistId)}" placeholder="Leave empty — will be created automatically" autocomplete="off">
        <div class="type-small" style="margin-top: 6px;">
          Optional. If you already have a gist from another device, paste its ID here to connect to the same backup.
        </div>
      </div>

      <div id="syncStatus" class="banner banner-info" style="margin-bottom: 16px;">Idle.</div>

      <div style="display: flex; gap: 12px; flex-wrap: wrap;">
        <button class="btn btn-primary" id="saveGh">Save GitHub settings</button>
        <button class="btn btn-gold"    id="syncNow">Sync now</button>
        <button class="btn btn-ghost"   id="pullNow">Pull from cloud</button>
        <button class="btn btn-ghost"   id="clearGh">Clear</button>
      </div>
    </div>

    <div class="card" style="margin-top: 20px;">
      <h2 class="type-h2" style="margin-bottom: 12px;">Deploy to GitHub Pages</h2>
      <p class="type-small" style="margin-bottom: 16px;">
        Creates a public repo under your account, uploads this site's files, enables Pages.
        Requires a <strong>one-time classic PAT with <span class="type-mono">public_repo</span> scope</strong> —
        different from your sync token.
        <a href="https://github.com/settings/tokens/new?scopes=public_repo&amp;description=AFOQT%20deploy" target="_blank" style="color:var(--gold-dark);text-decoration:underline;">Generate deploy PAT →</a>
        <br>
        The PAT is not stored anywhere — it lives in the form field below only until deploy finishes, then is wiped. Revoke it at GitHub after you're done.
      </p>

      <div class="form-field">
        <label class="form-label" for="deployPat">One-time deploy PAT (<span class="type-mono">public_repo</span> scope)</label>
        <input id="deployPat" class="form-input" placeholder="ghp_..." type="password" autocomplete="off">
      </div>

      <div class="form-field">
        <label class="form-label" for="deployRepo">Repo name</label>
        <input id="deployRepo" class="form-input" value="afoqt-study" placeholder="afoqt-study">
      </div>

      <div style="display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px;">
        <button class="btn btn-primary" id="deployBtn">Deploy to GitHub Pages</button>
      </div>

      <pre id="deployOut" style="font-family: var(--font-mono); font-size: 12px; line-height: 1.7; background: var(--parchment); border-radius: var(--r-md); padding: var(--s-3); color: var(--text); white-space: pre-wrap; word-break: break-word; max-height: 320px; overflow-y: auto; margin: 0; display: none;"></pre>
    </div>

    <div class="card" style="margin-top: 20px;">
      <h2 class="type-h2" style="margin-bottom: 12px;">Data</h2>
      <p class="type-small" style="margin-bottom: 16px;">Export your progress as JSON, or import a previous backup.</p>
      <div style="display: flex; gap: 12px; flex-wrap: wrap;">
        <button class="btn btn-gold"  id="exportBtn">Export JSON</button>
        <label class="btn btn-ghost" for="importFile" style="cursor:pointer;">Import JSON</label>
        <input id="importFile" type="file" accept="application/json" style="display:none;">
        <button class="btn btn-danger" id="resetBtn">Reset all data</button>
      </div>
    </div>

    <div class="card" style="margin-top: 20px;">
      <h2 class="type-h2" style="margin-bottom: 12px;">Keyboard shortcuts</h2>
      <div class="type-small" style="line-height: 2;">
        <strong>Session:</strong> Space pause/resume &middot; Escape cancel<br>
        <strong>Flashcard:</strong> Space/Enter flip &middot; 1 Again &middot; 2 Hard &middot; 3 Good &middot; 4 Easy
      </div>
    </div>

    <div class="cta-wrap"><button class="btn btn-ghost" onclick="location.hash='#home'">Back to home</button></div>
  `;

  $("#saveAnth").addEventListener("click", () => {
    const v = $("#anthKey").value.trim();
    if (v) localStorage.setItem(ANTHROPIC_KEY_KEY, v);
    else localStorage.removeItem(ANTHROPIC_KEY_KEY);
    alertBanner("Saved.");
    router();
  });
  $("#clearAnth").addEventListener("click", () => {
    localStorage.removeItem(ANTHROPIC_KEY_KEY);
    alertBanner("Cleared.");
    router();
  });
  $("#regenToday").addEventListener("click", async () => {
    const btn = $("#regenToday");
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Generating…";
    try {
      await generateDailyContent({ force: true });
      alertBanner("Today's content regenerated.");
    } catch (e) {
      alertBanner("Failed: " + (e.message || String(e)).slice(0, 80));
    } finally {
      btn.disabled = false;
      btn.textContent = orig;
    }
  });

  /* ----- GitHub cloud sync ----- */
  const syncStatusEl = $("#syncStatus");
  function paintSyncStatus(s) {
    if (!syncStatusEl) return;
    const when = s.at ? new Date(s.at).toLocaleTimeString() : '';
    const icon = s.status === 'synced' ? '✓'
               : s.status === 'syncing' ? '…'
               : s.status === 'error' ? '⚠'
               : '○';
    syncStatusEl.textContent = `${icon} ${s.status}${s.message ? ' — ' + s.message : ''}${when ? ' · ' + when : ''}`;
    const color = s.status === 'synced' ? 'var(--success)' :
                  s.status === 'error'  ? 'var(--danger)'  :
                  s.status === 'syncing' ? 'var(--gold)'   : 'var(--line)';
    syncStatusEl.style.borderLeft = '3px solid ' + color;
  }
  paintSyncStatus(_cloudSyncStatus);
  const statusHandler = (e) => paintSyncStatus(e.detail);
  window.addEventListener('afoqt:sync-status', statusHandler);

  $("#saveGh").addEventListener("click", () => {
    const pat = $("#ghPat").value.trim();
    const gid = $("#gistId").value.trim();
    if (pat) localStorage.setItem(GITHUB_PAT_KEY, pat); else localStorage.removeItem(GITHUB_PAT_KEY);
    if (gid) localStorage.setItem(GITHUB_GIST_ID_KEY, gid); else localStorage.removeItem(GITHUB_GIST_ID_KEY);
    alertBanner("Saved.");
    router();
  });
  $("#syncNow").addEventListener("click", async () => {
    if (!githubPat()) { alertBanner("Paste a GitHub PAT first."); return; }
    await cloudSync('auto');
  });
  $("#pullNow").addEventListener("click", async () => {
    if (!githubPat() || !githubGistId()) { alertBanner("Need PAT and Gist ID to pull."); return; }
    if (!confirm("Pull from cloud and overwrite local state?")) return;
    await cloudSync('download');
    router();
  });
  $("#clearGh").addEventListener("click", () => {
    if (!confirm("Clear GitHub token and gist ID locally? Your gist on GitHub is NOT deleted.")) return;
    localStorage.removeItem(GITHUB_PAT_KEY);
    localStorage.removeItem(GITHUB_GIST_ID_KEY);
    alertBanner("Cleared.");
    router();
  });

  // Clean up listener when leaving settings.
  onPageTeardown(() => window.removeEventListener('afoqt:sync-status', statusHandler));

  /* ----- One-click GitHub Pages deploy ----- */
  $("#deployBtn").addEventListener("click", async () => {
    const btn = $("#deployBtn");
    const out = $("#deployOut");
    const pat = $("#deployPat").value.trim();
    const repoName = ($("#deployRepo").value.trim() || 'afoqt-study').replace(/[^a-zA-Z0-9._-]/g, '-');
    if (!pat) { alertBanner("Paste a deploy PAT first."); return; }

    out.style.display = 'block';
    out.textContent = '';
    const log = (m) => {
      out.textContent += (out.textContent ? '\n' : '') + m;
      out.scrollTop = out.scrollHeight;
    };

    btn.disabled = true;
    const origText = btn.textContent;
    btn.textContent = 'Deploying…';
    try {
      const { url } = await runGitHubPagesDeploy({ pat, repoName, onLog: log });
      log('');
      log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      log('✓ DEPLOYED');
      log(url);
      log('');
      log('→ Bookmark this URL on every device');
      log('→ Revoke the PAT now at github.com/settings/tokens');
      $("#deployPat").value = '';
      alertBanner("Deployed. URL in the output below.");
    } catch (e) {
      log('');
      log('✗ FAILED: ' + (e.message || String(e)));
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  });

  $("#exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(STATE, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `afoqt-backup-${isoToday()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $("#importFile").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result);
        STATE = { ...defaultState(), ...data };
        saveState();
        alertBanner("Imported.");
        router();
      } catch { alertBanner("Import failed — invalid JSON."); }
    };
    r.readAsText(file);
  });

  $("#resetBtn").addEventListener("click", () => {
    if (confirm("Reset all data? This cannot be undone.")) {
      STATE = defaultState();
      saveState();
      alertBanner("Reset.");
      router();
    }
  });
}

function alertBanner(msg) {
  const n = document.createElement("div");
  n.className = "banner banner-info";
  n.textContent = msg;
  n.style.position = "fixed";
  n.style.top = "16px";
  n.style.left = "50%";
  n.style.transform = "translateX(-50%)";
  n.style.zIndex = "1000";
  n.style.background = "var(--card)";
  n.style.boxShadow = "var(--sh-lg)";
  document.body.appendChild(n);
  setTimeout(() => n.remove(), 1500);
}
