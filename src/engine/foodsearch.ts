// Forgiving food search: "dominos 3 meat", "timmies double double", "mcd 10 nuggets", "chiken breast".
// Pure functions, no DOM. Every query word must match (one miss allowed for 3+ words); matches in the
// food's own name rank above matches in its brand, aliases or category.

export interface SearchDoc {
  name: string;
  brand?: string | null;
  variant?: string | null;
  aliases?: readonly string[];
  category?: string | null;
}

export interface Hay {
  name: Set<string>; // tokens of name + variant
  all: string[]; // every token (name, variant, brand, brand nicknames, aliases, category)
  compact: string; // all text without spaces, for "bigmac", "mcnuggets" ⊃ "nuggets"
  phrase: string; // name, variant and aliases with spaces kept, "|" between them, for word-pair bonuses
  size: number; // number of name tokens (shorter, more specific names rank first)
}

/** Lowercase, strip accents and apostrophes, "A&W" → "aw", punctuation → space. */
export function normalize(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/\ba\s*(&|and|n)\s*w\b/g, "aw")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const tokens = (s: string) => (s ? normalize(s).split(" ").filter(Boolean) : []);

/** Nicknames people type for each chain (keys are normalized brand names). */
export const BRAND_NICK: Record<string, string> = {
  mcdonalds: "mcd mcds maccas mcdonald mickeyds",
  "tim hortons": "timmies timmys tims timhortons hortons",
  "burger king": "bk burgerking",
  kfc: "kentucky",
  starbucks: "sbux",
  "pizza pizza": "pizzapizza",
  "little caesars": "littlecaesars",
  "papa johns": "papajohns",
  "pizza hut": "pizzahut",
  dominos: "dominoes domino",
  popeyes: "popeye",
  "taco bell": "tacobell",
  harveys: "harvey",
  wendys: "wendy",
  "chick fil a": "chickfila cfa",
  chipotle: "chipotles",
  subway: "subs",
  aw: "a w",
  "dairy queen": "dq",
  "five guys": "5 guys fiveguys",
  "mary browns": "marybrowns",
  "swiss chalet": "swisschalet",
  "second cup": "secondcup",
  freshii: "freshi",
  "st hubert": "sthubert",
};

/** Query words that also mean something else. */
const SYN: Record<string, string[]> = {
  "1": ["one", "single"],
  one: ["1", "single"],
  single: ["1"],
  "2": ["two", "double"],
  two: ["2", "double"],
  double: ["2"],
  "3": ["three", "triple"],
  three: ["3", "triple"],
  triple: ["3"],
  "4": ["four"],
  four: ["4"],
  "5": ["five"],
  five: ["5"],
  "6": ["six"],
  six: ["6"],
  "8": ["eight"],
  eight: ["8"],
  "10": ["ten"],
  ten: ["10"],
  "12": ["twelve"],
  twelve: ["12"],
  "20": ["twenty"],
  twenty: ["20"],
  pc: ["piece", "pieces"],
  pcs: ["piece", "pieces"],
  piece: ["pc"],
  lg: ["large"],
  lrg: ["large"],
  med: ["medium"],
  md: ["medium"],
  sm: ["small"],
  xl: ["xlarge", "extra large"],
  bfast: ["breakfast"],
  brekky: ["breakfast"],
  coke: ["cola", "coca"],
  pop: ["soft drink", "cola", "soda"],
  soda: ["soft drink", "cola", "pop"],
  fries: ["fry", "frites"],
  chips: ["fries", "crisps"],
  nugget: ["nuggets", "mcnuggets"],
  nuggies: ["nuggets", "mcnuggets"],
  burger: ["burgers", "hamburger"],
  sandwich: ["sub", "sandwiches"],
  sub: ["sandwich"],
  meatlovers: ["meat lovers", "3 meat"],
  pepperoni: ["pepp", "peperoni"],
  pep: ["pepperoni"],
  cheeseburger: ["cheese burger"],
  coffee: ["brewed", "americano"],
  latte: ["lattes"],
  oj: ["orange juice"],
  pb: ["peanut butter"],
  avo: ["avocado"],
};

const STOP = new Set(["a", "an", "the", "of", "with", "w", "and", "from", "at", "in", "on", "my", "some", "order", "meal"]);

export function buildHay(d: SearchDoc): Hay {
  const name = [...tokens(d.name), ...tokens(d.variant ?? "")];
  const brandNorm = normalize(d.brand ?? "");
  const brand = [...tokens(d.brand ?? ""), ...(BRAND_NICK[brandNorm] ?? "").split(" ").filter(Boolean)];
  const extra = [...(d.aliases ?? []).flatMap(tokens), ...tokens(d.category ?? "")];
  const all = [...new Set([...name, ...brand, ...extra])];
  const compact = [normalize(d.name), normalize(d.variant ?? ""), brandNorm, ...(d.aliases ?? []).map(normalize)].join("|").replace(/ /g, "");
  const texts = [normalize(d.name), normalize(d.variant ?? ""), ...(d.aliases ?? []).map(normalize)].filter(Boolean);
  return { name: new Set(name), all, compact, phrase: `|${texts.join("|")}|`, size: name.length };
}

/** Edit distance ≤ 1 (one insert, delete or substitution). */
function near(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (la > lb) i++;
    else if (lb > la) j++;
    else { i++; j++; }
  }
  return edits + (la - i) + (lb - j) <= 1;
}

export interface QueryWord {
  alts: string[]; // the word itself first, then synonyms (each may be several tokens joined without spaces)
}

export function parseQuery(q: string): QueryWord[] {
  const raw = tokens(q);
  const kept = raw.filter((t) => !STOP.has(t));
  const words = kept.length ? kept : raw;
  return words.map((w) => {
    const alts = [w, ...(SYN[w] ?? []).map((s) => normalize(s).replace(/ /g, ""))];
    if (w.length > 3 && w.endsWith("s")) alts.push(w.slice(0, -1)); // nuggets → nugget
    if (w.length > 4 && w.endsWith("es")) alts.push(w.slice(0, -2)); // dominoes → domino
    return { alts: [...new Set(alts)] };
  });
}

/** Score of one word against a food; 0 = no match. */
function wordScore(h: Hay, w: QueryWord): number {
  let best = 0;
  w.alts.forEach((a, ai) => {
    const synPenalty = ai === 0 ? 0 : 1;
    for (const t of h.all) {
      let s = 0;
      if (t === a) s = 10;
      else if (a.length >= 2 && !/^\d+$/.test(a) && t.startsWith(a)) s = 6;
      else if (a.length >= 5 && t.length >= 4 && near(a, t)) s = 3;
      if (s && h.name.has(t)) s += 3;
      if (s) best = Math.max(best, s - synPenalty);
    }
    if (!best && a.length >= 4 && h.compact.includes(a)) best = Math.max(best, 4 - synPenalty);
  });
  return best;
}

/** Score and number of unmatched words, or null when the food doesn't match. */
export function scoreHay(h: Hay, q: readonly QueryWord[]): { s: number; misses: number } | null {
  if (!q.length) return null;
  const allowMiss = q.length >= 3 ? 1 : 0;
  let total = 0, misses = 0;
  for (const w of q) {
    const s = wordScore(h, w);
    if (!s) {
      if (++misses > allowMiss) return null;
      total -= 12;
    } else total += s;
  }
  // Words typed in the same order as the name or an alias ("double double", "big mac") rank higher,
  // and an exact name/alias match ranks highest.
  for (let i = 0; i + 1 < q.length; i++) if (h.phrase.includes(`${q[i].alts[0]} ${q[i + 1].alts[0]}`)) total += 4;
  if (q.length > 1 && h.phrase.includes(`|${q.map((w) => w.alts[0]).join(" ")}|`)) total += 6;
  return { s: total - h.size * 0.2, misses };
}

/** Ranks items by score (ties keep the input order, so put the most popular first). */
export function rank<T>(items: readonly T[], hay: (t: T, i: number) => Hay, q: string, limit = 50): T[] {
  const words = parseQuery(q);
  if (!words.length) return [];
  const scored: { t: T; s: number; i: number; misses: number }[] = [];
  items.forEach((t, i) => {
    const r = scoreHay(hay(t, i), words);
    if (r) scored.push({ t, s: r.s, i, misses: r.misses });
  });
  scored.sort((a, b) => a.misses - b.misses || b.s - a.s || a.i - b.i);
  // Near misses (one word unmatched) only fill in when full matches are few.
  const full = scored.filter((x) => x.misses === 0);
  const out = full.length >= 5 ? full : scored;
  return out.slice(0, limit).map((x) => x.t);
}
