// Vercel serverless function for the desktop hotkey advisor.
// Takes a table screenshot, reads the cards with the same vision call as
// /api/scan, then runs the same odds engine as the web app server-side and
// returns a plain-JSON verdict (no HTML/DOM involved).

const R = "23456789TJQKA", S = "cdhs";
const name = c => R[c >> 2] + S[c & 3];

function parse(t) {
  if (typeof t !== "string" || t.length < 2) return null;
  const r = R.indexOf(t[0].toUpperCase().replace("1", "T"));
  const s = S.indexOf(t[t.length - 1].toLowerCase());
  return r < 0 || s < 0 ? null : r * 4 + s;
}

// ---- evaluator (7 cards -> score), ported verbatim from index.html ----
function st(m) { for (let h = 12; h >= 4; h--) if (((m >> (h - 4)) & 31) === 31) return h; return (m & 0x100F) === 0x100F ? 3 : -1 }
const pack = a => { let v = 0; for (let i = 0; i < 5; i++) v = v * 13 + (a[i] || 0); return v };
function ev(cs) {
  const rc = new Array(13).fill(0), sc = [0, 0, 0, 0], sm = [0, 0, 0, 0]; let all = 0;
  for (const c of cs) { const r = c >> 2, s = c & 3; rc[r]++; sc[s]++; sm[s] |= 1 << r; all |= 1 << r }
  const K = 371293; let fm = 0; for (let s = 0; s < 4; s++) if (sc[s] >= 5) fm = sm[s];
  if (fm) { const h = st(fm); if (h >= 0) return 8 * K + pack([h]) }
  const q = [], t = [], p = [], o = [];
  for (let r = 12; r >= 0; r--) { const n = rc[r]; if (n === 4) q.push(r); else if (n === 3) t.push(r); else if (n === 2) p.push(r); else if (n === 1) o.push(r) }
  if (q.length) { const k = Math.max(...[...t, ...p, ...o].filter(x => x !== q[0]), ...(q[1] != null ? [q[1]] : [])); return 7 * K + pack([q[0], k]) }
  if (t.length && (t.length > 1 || p.length)) { const s2 = Math.max(t[1] ?? -1, p[0] ?? -1); return 6 * K + pack([t[0], s2]) }
  if (fm) { const top = []; for (let r = 12; r >= 0 && top.length < 5; r--) if (fm >> r & 1) top.push(r); return 5 * K + pack(top) }
  const h = st(all); if (h >= 0) return 4 * K + pack([h]);
  if (t.length) return 3 * K + pack([t[0], o[0], o[1]]);
  if (p.length > 1) { const k = Math.max(p[2] ?? -1, o[0] ?? -1); return 2 * K + pack([p[0], p[1], k]) }
  if (p.length) return 1 * K + pack([p[0], o[0], o[1], o[2]]);
  return pack(o.slice(0, 5));
}
const CAT = ["High card", "Pair", "Two pair", "Three of a kind", "Straight", "Flush", "Full house", "Four of a kind", "Straight flush"];
const HANDK = 371293;

const HOLE_PAIRS_4 = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
// Generic k-combination generator (indices into arr), used both for the
// Omaha "which 3 board cards" choice and for exact opponent-hand
// enumeration below - replaces the old combos3-only helper.
function combosN(arr, k) {
  const res = [], n = arr.length, combo = [];
  (function rec(start) {
    if (combo.length === k) { res.push(combo.slice()); return }
    for (let i = start; i < n; i++) { combo.push(arr[i]); rec(i + 1); combo.pop() }
  })(0);
  return res;
}
function combos3(arr) { return combosN(arr, 3) }
function evOmaha(hole, board) {
  let best = -1;
  const triples = combos3(board);
  for (const [i, j] of HOLE_PAIRS_4) {
    const pair = [hole[i], hole[j]];
    for (const t of triples) { const s = ev(pair.concat(t)); if (s > best) best = s }
  }
  return best;
}
function bestScore(hole, board, game) {
  if (game === "omaha") { if (board.length < 3) return -1; return evOmaha(hole, board) }
  return ev(hole.concat(board));
}
function holeCountFor(game) { return game === "omaha" ? 4 : 2 }

// ---- exact (non-random) combinatorics, replacing the old Monte Carlo ----
// nCk via the standard multiplicative formula; deck sizes here are small
// (well under 50) so plain floating point is exact enough for our purposes.
function comb(n, k) {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return r;
}
// Hypergeometric "hit at least one out" probability: given `outs` live
// cards among `deckSize` unseen cards, what's the chance at least one of
// them appears among the next `draws` cards to come? This is the exact
// version of the classic "outs x 2 / outs x 4" rule of thumb.
function hitProbability(outs, deckSize, draws) {
  if (outs <= 0 || draws <= 0 || deckSize <= 0) return 0;
  const missProb = comb(deckSize - outs, draws) / comb(deckSize, draws);
  return 1 - missProb;
}

function outsAnalysis(hole, board, game) {
  const used = new Set([...hole, ...board]); const deck = []; for (let c = 0; c < 52; c++) if (!used.has(c)) deck.push(c);
  const res = {};
  if (board.length === 3) {
    const turnC = new Array(9).fill(0);
    for (const t of deck) { const cat = Math.floor(bestScore(hole, board.concat([t]), game) / HANDK); turnC[cat]++ }
    res.turn = { counts: turnC, total: deck.length };
    const riverC = new Array(9).fill(0); let tot = 0;
    for (let i = 0; i < deck.length; i++) for (let j = i + 1; j < deck.length; j++) { const cat = Math.floor(bestScore(hole, board.concat([deck[i], deck[j]]), game) / HANDK); riverC[cat]++; tot++ }
    res.river = { counts: riverC, total: tot };
  } else if (board.length === 4) {
    const riverC = new Array(9).fill(0);
    for (const r of deck) { const cat = Math.floor(bestScore(hole, board.concat([r]), game) / HANDK); riverC[cat]++ }
    res.river = { counts: riverC, total: deck.length };
  }
  return res;
}
function tableRows(counts, total) {
  const rows = [];
  for (let i = 8; i >= 0; i--) {
    if (!counts[i]) continue;
    const pct = counts[i] / total * 100;
    rows.push({ hand: CAT[i], outs: counts[i], pct: Math.round(pct * 10) / 10 });
  }
  rows.sort((a, b) => b.pct - a.pct);
  return rows;
}

// Exact distribution of a single random opponent's best hand category,
// found by enumerating every possible hole-card combination left in the
// deck (not sampling) - replaces the old Monte Carlo opponent-hand tally.
function opponentCategoryDist(hole, board, game) {
  const used = new Set([...hole, ...board]); const deck = []; for (let c = 0; c < 52; c++) if (!used.has(c)) deck.push(c);
  const hc = holeCountFor(game);
  const counts = new Array(9).fill(0);
  let total = 0;
  for (const combo of combosN(deck, hc)) {
    const cat = Math.floor(bestScore(combo, board, game) / HANDK);
    counts[cat]++; total++;
  }
  return total ? counts.map(c => c / total) : counts;
}

// How many opponents are still in the hand shaves equity off a made hand or
// a draw even though we aren't simulating their cards directly: with more
// players left to act behind you, the same hand/draw is less likely to
// still be best by showdown. A flat multiplier per extra opponent is a
// simple, deterministic stand-in for that (no randomness involved).
const PER_OPPONENT_DISCOUNT = 0.12;
const MIN_DISCOUNT_FACTOR = 0.15;
function opponentDiscount(opps) {
  return Math.max(MIN_DISCOUNT_FACTOR, 1 - PER_OPPONENT_DISCOUNT * (opps - 1));
}

// Rough heads-up showdown-win baseline per made-hand category, used (a) at
// the river, where there are no more outs to count, and (b) blended into
// the flop/turn outs calculation so an already-strong hand (e.g. a flopped
// full house) doesn't read as low equity just because it has few outs left
// to improve further - it was already winning most of the time as-is.
const CATEGORY_WIN_BASELINE = [0.15, 0.35, 0.50, 0.60, 0.70, 0.80, 0.90, 0.95, 0.97];

// Shared by both the vision path and the manual-entry path: works out the
// recommendation once hole/board cards and opponents/pot/call are known,
// however they were obtained. Equity is now calculated directly rather
// than estimated by Monte Carlo simulation:
//   - preflop: a flat baseline per starting-hand tier (premium/playable/other)
//   - flop/turn: exact outs count, converted to a hit probability via the
//     hypergeometric formula (the "rule of 2 and 4", done exactly)
//   - river: a flat baseline per made-hand category, since there are no
//     more outs to count once the board is complete
// All of the above are then discounted by opponent count.
function buildVerdict(hole, board, game, opps, opponentsDetected, pot, potDetected, call, callDetected) {
  const discount = opponentDiscount(opps);
  const fair = 1 / (opps + 1);
  let rec, why;

  let madeHand = null, madeIdx = null, better = [], turnTable = null, riverTable = null, outsCount = null;

  // Preflop hand-category classification (Hold'em only): lets the advice
  // reference standard starting-hand groups (pocket pairs, suited broadways,
  // AK/AQ, suited connectors) rather than relying on a simulated equity number.
  let preflopCat = null, premiumPreflop = false, playablePreflop = false;
  if (board.length === 0 && game === "holdem" && hole.length === 2) {
    const ranks = [hole[0] >> 2, hole[1] >> 2].sort((a, b) => b - a);
    const suited = (hole[0] & 3) === (hole[1] & 3);
    const isPair = ranks[0] === ranks[1];
    if (isPair) {
      preflopCat = `a pocket pair (${R[ranks[0]]}${R[ranks[0]]})`;
      premiumPreflop = ranks[0] >= 9;   // JJ, QQ, KK, AA
      playablePreflop = ranks[0] >= 4;  // 66 and up
    } else {
      preflopCat = `${R[ranks[0]]}${R[ranks[1]]}${suited ? " suited" : " offsuit"}`;
      const gap = ranks[0] - ranks[1] - 1;
      if (ranks[0] === 12 && ranks[1] >= 10) { premiumPreflop = true; playablePreflop = true; } // AK, AQ
      else if (ranks[0] >= 10 && ranks[1] >= 8 && suited) { playablePreflop = true; } // suited broadways: KQs, KJs, QJs, JTs
      else if (suited && gap <= 1 && ranks[1] >= 4) { playablePreflop = true; } // suited connectors/one-gappers, 65s and up
      else if (ranks[0] === 12) { playablePreflop = true; } // any ace
    }
  }

  if (board.length >= 3) {
    madeIdx = Math.floor(bestScore(hole, board, game) / HANDK);
    madeHand = CAT[madeIdx];
    const oa = outsAnalysis(hole, board, game);
    if (oa.turn) turnTable = { total: oa.turn.total, rows: tableRows(oa.turn.counts, oa.turn.total) };
    if (oa.river) riverTable = { total: oa.river.total, cumulative: board.length === 3, rows: tableRows(oa.river.counts, oa.river.total) };

    // Exact "chance the best opponent already has (or ends up with) a
    // better category than you", via the single-opponent distribution
    // raised to the Nth-opponent order statistic (max of N independent
    // draws) - a closed-form replacement for the old simulated tally.
    const oppDist = opponentCategoryDist(hole, board, game);
    const cdf = []; let acc = 0; for (let i = 0; i < 9; i++) { acc += oppDist[i]; cdf.push(acc) }
    const betterIdx = []; for (let i = 8; i > madeIdx; i--) betterIdx.push(i);
    better = betterIdx.map(i => {
      const prevCdf = i > 0 ? cdf[i - 1] : 0;
      const pMaxEqualsI = Math.pow(cdf[i], opps) - Math.pow(prevCdf, opps);
      return { hand: CAT[i], pct: Math.round(pMaxEqualsI * 1000) / 10 };
    });
    better.sort((a, b) => b.pct - a.pct);
  }

  // Absolute hand strength, independent of the equity number: a full house
  // or better is a strong made hand almost regardless of how many
  // opponents are in, so let it push the recommendation up even when the
  // raw equity math alone wouldn't clear the usual threshold.
  const strongAbsolute = madeIdx != null && madeIdx >= 6;   // full house, quads, straight flush
  const nutAbsolute = madeIdx != null && madeIdx >= 7;      // quads or straight flush

  let eq, equityWhy;
  if (board.length === 0) {
    // No board yet, so there's nothing to count outs against: fall back to
    // a flat baseline per starting-hand tier from the classification above.
    let base, tierLabel;
    if (game === "holdem") {
      if (premiumPreflop) { base = 0.75; tierLabel = "a premium" }
      else if (playablePreflop) { base = 0.55; tierLabel = "a playable" }
      else { base = 0.35; tierLabel = "a speculative" }
    } else {
      // Omaha starting hands run closer together and aren't classified
      // above, so use a single neutral baseline.
      base = 0.45; tierLabel = "an unclassified Omaha";
    }
    eq = Math.max(0, Math.min(0.99, base * discount));
    equityWhy = `There's no board yet, so there are no outs to count. Preflop equity is approximated from standard starting-hand tiers instead: ${preflopCat ? `${preflopCat} is treated as ${tierLabel} holding` : `this is treated as ${tierLabel} holding`} (~${(base * 100).toFixed(0)}% baseline heads-up). With ${opps} opponent${opps > 1 ? "s" : ""} in the pot, that's discounted to about ${(eq * 100).toFixed(1)}%.`;
  } else if (board.length === 5) {
    // Hand is complete - no more cards to come, so no outs either. Fall
    // back to a flat baseline per made-hand category instead.
    const base = CATEGORY_WIN_BASELINE[madeIdx];
    eq = Math.max(0, Math.min(0.99, base * discount));
    equityWhy = `The board is complete, so there are no more outs to count. As a rule of thumb, ${madeHand.toLowerCase()} is worth roughly ${(base * 100).toFixed(0)}% heads-up at showdown; with ${opps} opponent${opps > 1 ? "s" : ""} still in, that's discounted to about ${(eq * 100).toFixed(1)}%.`;
  } else {
    // Flop (2 cards to come) or turn (1 card to come): count exact outs -
    // deck cards that would improve the hand beyond its current category -
    // and convert to a hit probability with the hypergeometric formula.
    // Blended with the current category's own baseline win rate, so an
    // already-strong made hand (e.g. a flopped full house, with few outs
    // left to improve further) still reads as high equity rather than
    // scoring near zero just because there's little left to draw to.
    const deckSize = 52 - hole.length - board.length;
    const draws = 5 - board.length;
    const table = board.length === 3 ? turnTable : riverTable;
    outsCount = table ? table.rows.reduce((sum, row) => sum + (CAT.indexOf(row.hand) > madeIdx ? row.outs : 0), 0) : 0;
    const rawHit = hitProbability(outsCount, deckSize, draws);
    const baseline = CATEGORY_WIN_BASELINE[madeIdx];
    const combined = baseline + (1 - baseline) * rawHit;
    eq = Math.max(0, Math.min(0.99, combined * discount));
    const streetWord = draws === 2 ? "two cards to come" : "one card to come";
    equityWhy = `You currently have ${madeHand.toLowerCase()} (worth roughly ${(baseline * 100).toFixed(0)}% heads-up as-is), plus ${outsCount} out${outsCount === 1 ? "" : "s"} — cards left in the deck that improve you further — out of ${deckSize} unseen cards, with ${streetWord}. By the exact hypergeometric odds (no simulation involved), that's a ${(rawHit * 100).toFixed(1)}% chance of hitting at least one of those outs, for a combined ${(combined * 100).toFixed(1)}% before opponents. With ${opps} opponent${opps > 1 ? "s" : ""} in the pot, that's discounted to about ${(eq * 100).toFixed(1)}%.`;
  }

  if (call > 0) {
    const need = call / (pot + call);
    why = `Equity needed = call ÷ (pot + call) = ${call} ÷ (${pot} + ${call}) = ${(need * 100).toFixed(1)}%. That's the break-even point: call this often (in equivalent spots) and you win back exactly what you put in. This hand is worked out at about ${(eq * 100).toFixed(0)}% equity, so `;
    if (nutAbsolute || premiumPreflop || (eq > need + 0.25 && eq > 0.6)) rec = "RAISE";
    else if (strongAbsolute || playablePreflop || eq >= need + 0.03) rec = "CALL";
    else if (eq >= need - 0.03 && board.length < 5) rec = "CALL";
    else rec = "FOLD";
    why += eq >= need ? `you're above the ${(need * 100).toFixed(1)}% you need — calling profits on average.` : `you're below the ${(need * 100).toFixed(1)}% you need — calling loses on average.`;
    if (strongAbsolute) why += ` On top of that, you've made ${madeHand.toLowerCase()} — a strong absolute hand in its own right, worth playing aggressively even if the equity math alone looked marginal.`;
    else if (preflopCat && premiumPreflop) why += ` You're holding ${preflopCat} — a premium starting hand that plays well against a raise regardless of the exact equity number.`;
    else if (preflopCat && playablePreflop && rec === "CALL") why += ` You're holding ${preflopCat} — a playable starting hand, worth seeing a flop with here.`;
    else if (rec === "CALL" && eq < need + 0.03) why += " It's marginal; drawing hands with future bets can justify it.";
  } else {
    const fairPct = (fair * 100).toFixed(1);
    const fairCalc = `an even share = 1 ÷ (opponents + 1) = 1 ÷ (${opps} + 1) = ${fairPct}%`;
    if (strongAbsolute) { rec = "BET"; why = `You've made ${madeHand.toLowerCase()} — a strong absolute hand regardless of the exact equity number. Bet for value, roughly half to two-thirds of the pot.` }
    else if (preflopCat && premiumPreflop) { rec = "BET"; why = `You're holding ${preflopCat} — a premium starting hand. Raise here regardless of opponent count; this is a hand you want to build the pot with.` }
    else if (eq > Math.max(0.6, fair + 0.2)) { rec = "BET"; why = `Well ahead of ${fairCalc}. Bet for value, roughly half to two-thirds of the pot.` }
    else if (preflopCat && playablePreflop) { rec = "BET"; why = `You're holding ${preflopCat} — a playable starting hand. A raise here builds the pot while you have position/hand-strength working for you, though it's not a premium — be ready to fold to heavy resistance.` }
    else if (eq > fair + 0.08 && board.length < 5) { rec = "BET"; why = `Ahead of ${fairCalc}. A modest bet builds the pot and denies free cards.` }
    else if (preflopCat) { rec = "CHECK"; why = `You're holding ${preflopCat} — not strong enough to open-raise in most spots. Check/fold unless you're getting a cheap look.` }
    else { rec = "CHECK"; why = `Not clearly ahead of ${fairCalc}. Check and see the next card cheaply.` }
  }

  return {
    hole: hole.map(name),
    board: board.map(name),
    game,
    opponents: opps,
    opponentsDetected,
    pot,
    potDetected,
    call,
    callDetected,
    equity: Math.round(eq * 1000) / 10,
    equityWhy,
    recommendation: rec,
    why,
    madeHand,
    preflopCat,
    better,
    turnTable,
    riverTable,
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const code = process.env.APP_PASSCODE;
  if (code && req.headers["x-passcode"] !== code) return res.status(401).end();
  const fallbackOpps = Math.min(9, Math.max(1, parseInt(req.body.opponents, 10) || 1));
  const fallbackPot = Number(req.body.pot) || 0;
  const fallbackCall = Number(req.body.call) || 0;
  const game = req.body.game === "omaha" ? "omaha" : "holdem";
  const hc = holeCountFor(game);

  // ---- manual card entry: cards were typed in, so skip the screenshot/vision call entirely ----
  if (Array.isArray(req.body.manualHole) && req.body.manualHole.length) {
    try {
      const seen = new Set();
      const hole = [];
      req.body.manualHole.slice(0, hc).forEach(t => { const c = parse(t); if (c != null && !seen.has(c)) { hole.push(c); seen.add(c) } });
      if (hole.length < hc) {
        return res.status(422).json({ error: `Enter all ${hc} hole cards clearly, e.g. "${hc === 4 ? "Ah Kd Qc Js" : "Ah Kd"}".` });
      }
      const boardRaw = Array.isArray(req.body.manualBoard) ? req.body.manualBoard : [];
      const board = [];
      boardRaw.slice(0, 5).forEach(t => { const c = parse(t); if (c != null && !seen.has(c)) { board.push(c); seen.add(c) } });
      const allowedLens = [0, 3, 4, 5];
      if (!allowedLens.includes(board.length)) {
        return res.status(422).json({ error: "Board must have exactly 0, 3, 4 or 5 cards." });
      }
      return res.status(200).json(buildVerdict(hole, board, game, fallbackOpps, true, fallbackPot, true, fallbackCall, true));
    } catch (e) {
      console.error("manual advise exception", e);
      return res.status(500).json({ error: "advise failed", detail: String(e) });
    }
  }

  // ---- screenshot / vision path ----
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY. Add it in Vercel project settings and redeploy." });
  }
  const image = req.body && req.body.image;
  if (!image || image.length > 4_000_000) return res.status(400).json({ error: "Missing or too-large image." });

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.MODEL || "claude-sonnet-5",
        max_tokens: 600,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
              { type: "text", text: `Respond with JSON only - your first character must be "{" and your last character must be "}", with no reasoning, commentary, or markdown before, between, or after. This photo shows a poker table (an online poker app screen). Identify: (1) the player's ${hc} hole cards (held in hand or closest to the camera); (2) the community cards on the table (0, 3, 4 or 5). Use two-character codes: rank (2-9,T,J,Q,K,A) then suit (c,d,h,s), e.g. "As", "Td". Diamonds (d) and hearts (h) are both red and easy to confuse at small size — a diamond is a plain pointed rhombus with a smooth top point, while a heart has a curved double-lobe with a notch/dip at the top; look closely at the top edge of each red suit symbol before deciding which it is. Clubs (c) and spades (s) are both black and equally easy to confuse — a club is a three-lobed clover/trefoil shape (three separate rounded bumps) sitting on a stem, while a spade is a single smooth pointed leaf/teardrop shape (one point, no separate lobes) sitting on a stem; count the lobes at the top before deciding which it is.${game === "omaha" ? " This is Omaha, so 4 hole cards are shown close together and each one is smaller on screen than in a 2-card Hold'em hand — examine each of the 4 hole cards' suit individually and don't assume a card shares its neighbor's suit just because they're close together." : ""} Omit any card you are unsure of. Also read from the on-screen UI, if clearly visible: (3) "opponents": the number of other players still active in this hand (still seated with cards, not folded/sitting out), as a plain integer, or null if you can't tell; (4) "pot": the total pot size shown on screen, as a plain number with no currency symbols or commas (e.g. 45.5, not "$45.50"), or null if not visible; (5) "call": the amount currently needed to call / the outstanding bet facing the player, as a plain number, or null if there is no bet to call right now or it isn't legible. Reply with ONLY a single JSON object and nothing else — no explanation, no markdown code fences: {"hole":[...],"board":[...],"opponents":<int or null>,"pot":<number or null>,"call":<number or null>}` },
            ],
          },
        ],
      }),
    });
    if (!r.ok) {
      const errBody = await r.text();
      console.error("Anthropic API error", r.status, errBody);
      return res.status(502).json({ error: `Anthropic API returned ${r.status}`, detail: errBody.slice(0, 300) });
    }
    const j = await r.json();
    let text = (j.content || []).map(c => c.text || "").join("");
    // Defensive: the prompt says "no markdown code fences", but strip one
    // anyway if the model wrapped its reply in ```json ... ``` despite that.
    text = text.replace(/```json\s*/i, "").replace(/```\s*$/, "").trim();
    const truncated = j.stop_reason === "max_tokens";
    const truncNote = truncated ? " (the reply was cut off for running out of room - try again.)" : "";
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return res.status(502).json({ error: "Model reply had no parseable JSON." + truncNote, detail: text.slice(0, 500) || "(empty reply)" });
    let raw;
    try {
      raw = JSON.parse(m[0]);
    } catch (parseErr) {
      return res.status(502).json({ error: "Model reply had malformed JSON." + truncNote, detail: text.slice(0, 500) });
    }

    const seen = new Set();
    // Once the hole cards have been read correctly once this hand, the
    // client sends them back as lockedHole on every later screenshot - use
    // those fixed cards instead of whatever the vision model guesses for
    // hole this time, so a correct preflop read can't be clobbered by a
    // later misread (this is where most suit-misread reports come from).
    let hole = [];
    const lockedRaw = Array.isArray(req.body.lockedHole) ? req.body.lockedHole : null;
    if (lockedRaw && lockedRaw.length === hc) {
      lockedRaw.forEach(t => { const c = parse(t); if (c != null && !seen.has(c)) { hole.push(c); seen.add(c) } });
    }
    if (hole.length !== hc) {
      // No valid locked hand supplied - fall back to reading it fresh.
      hole = [];
      seen.clear();
      (raw.hole || []).slice(0, hc).forEach(t => { const c = parse(t); if (c != null && !seen.has(c)) { hole.push(c); seen.add(c) } });
    }
    const boardAll = [];
    (raw.board || []).slice(0, 5).forEach(t => { const c = parse(t); if (c != null && !seen.has(c)) { boardAll.push(c); seen.add(c) } });
    const allowedLens = [0, 3, 4, 5];
    let boardLen = 0;
    for (const l of allowedLens) if (boardAll.length >= l) boardLen = l;
    const board = boardAll.slice(0, boardLen);

    if (hole.length < hc) {
      return res.status(422).json({ error: `Couldn't clearly read all ${hc} hole cards.`, hole: hole.map(name), board: board.map(name) });
    }

    const rawOpp = raw.opponents != null ? Number(raw.opponents) : NaN;
    const opponentsDetected = Number.isFinite(rawOpp) && rawOpp > 0;
    const opps = opponentsDetected ? Math.min(9, Math.max(1, Math.round(rawOpp))) : fallbackOpps;

    const rawPot = raw.pot != null ? Number(raw.pot) : NaN;
    const potDetected = Number.isFinite(rawPot) && rawPot >= 0;
    const pot = potDetected ? rawPot : fallbackPot;

    const rawCall = raw.call != null ? Number(raw.call) : NaN;
    const callDetected = Number.isFinite(rawCall) && rawCall >= 0;
    const call = callDetected ? rawCall : fallbackCall;

    const verdict = buildVerdict(hole, board, game, opps, opponentsDetected, pot, potDetected, call, callDetected);
    res.status(200).json(verdict);
  } catch (e) {
    console.error("advise handler exception", e);
    res.status(500).json({ error: "advise failed", detail: String(e) });
  }
}
