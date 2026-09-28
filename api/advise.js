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

function simulate(hole, board, opps, N) {
  const used = new Set([...hole, ...board]); const deck = []; for (let c = 0; c < 52; c++) if (!used.has(c)) deck.push(c);
  const need = 5 - board.length, dl = deck.length; let win = 0, tie = 0, lose = 0;
  const oppCat = new Array(9).fill(0);
  for (let n = 0; n < N; n++) {
    const k = need + opps * 2;
    for (let i = 0; i < k; i++) { const j = i + Math.floor(Math.random() * (dl - i)); const x = deck[i]; deck[i] = deck[j]; deck[j] = x }
    const full = board.concat(deck.slice(0, need));
    const me = ev(hole.concat(full)); let best = -1, cnt = 0;
    for (let o = 0; o < opps; o++) { const a = deck[need + o * 2], b = deck[need + o * 2 + 1]; const s = ev([a, b].concat(full)); if (s > best) { best = s; cnt = 1 } else if (s === best) cnt++ }
    if (best >= 0) oppCat[Math.floor(best / HANDK)]++;
    if (me > best) win++; else if (me === best) tie += 1 / (cnt + 1); else lose++;
  }
  return { eq: (win + tie) / N, oppCat, N };
}

function outsAnalysis(hole, board) {
  const used = new Set([...hole, ...board]); const deck = []; for (let c = 0; c < 52; c++) if (!used.has(c)) deck.push(c);
  const res = {};
  if (board.length === 3) {
    const turnC = new Array(9).fill(0);
    for (const t of deck) { const cat = Math.floor(ev(hole.concat(board).concat([t])) / HANDK); turnC[cat]++ }
    res.turn = { counts: turnC, total: deck.length };
    const riverC = new Array(9).fill(0); let tot = 0;
    for (let i = 0; i < deck.length; i++) for (let j = i + 1; j < deck.length; j++) { const cat = Math.floor(ev(hole.concat(board).concat([deck[i], deck[j]])) / HANDK); riverC[cat]++; tot++ }
    res.river = { counts: riverC, total: tot };
  } else if (board.length === 4) {
    const riverC = new Array(9).fill(0);
    for (const r of deck) { const cat = Math.floor(ev(hole.concat(board).concat([r])) / HANDK); riverC[cat]++ }
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
  return rows;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const code = process.env.APP_PASSCODE;
  if (code && req.headers["x-passcode"] !== code) return res.status(401).end();
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY. Add it in Vercel project settings and redeploy." });
  }
  const image = req.body && req.body.image;
  if (!image || image.length > 4_000_000) return res.status(400).json({ error: "Missing or too-large image." });
  const opps = Math.min(9, Math.max(1, parseInt(req.body.opponents, 10) || 1));
  const pot = Number(req.body.pot) || 0;
  const call = Number(req.body.call) || 0;

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
        max_tokens: 300,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
            { type: "text", text: 'This photo shows playing cards at a poker table. Identify the player\'s two hole cards (held in hand or closest to the camera) and the community cards on the table (0, 3, 4 or 5). Use two-character codes: rank (2-9,T,J,Q,K,A) then suit (c,d,h,s), e.g. "As", "Td". Omit any card you are unsure of. Reply ONLY with JSON: {"hole":[...],"board":[...]}' },
          ],
        }],
      }),
    });
    if (!r.ok) {
      const errBody = await r.text();
      console.error("Anthropic API error", r.status, errBody);
      return res.status(502).json({ error: `Anthropic API returned ${r.status}`, detail: errBody.slice(0, 300) });
    }
    const j = await r.json();
    const text = (j.content || []).map(c => c.text || "").join("");
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return res.status(502).json({ error: "Model reply had no parseable JSON.", detail: text.slice(0, 300) });
    const raw = JSON.parse(m[0]);

    const seen = new Set();
    const hole = [];
    (raw.hole || []).slice(0, 2).forEach(t => { const c = parse(t); if (c != null && !seen.has(c)) { hole.push(c); seen.add(c) } });
    const boardAll = [];
    (raw.board || []).slice(0, 5).forEach(t => { const c = parse(t); if (c != null && !seen.has(c)) { boardAll.push(c); seen.add(c) } });
    const allowedLens = [0, 3, 4, 5];
    let boardLen = 0;
    for (const l of allowedLens) if (boardAll.length >= l) boardLen = l;
    const board = boardAll.slice(0, boardLen);

    if (hole.length < 2) {
      return res.status(422).json({ error: "Couldn't clearly read both hole cards.", hole: hole.map(name), board: board.map(name) });
    }

    const sim = simulate(hole, board, opps, board.length === 0 ? 12000 : 20000);
    const eq = sim.eq;
    const fair = 1 / (opps + 1);
    let rec, why;
    let madeHand = null, better = [], turnTable = null, riverTable = null;

    if (board.length >= 3) {
      const madeIdx = Math.floor(ev(hole.concat(board)) / HANDK);
      madeHand = CAT[madeIdx];
      const betterIdx = []; for (let i = 8; i > madeIdx; i--) betterIdx.push(i);
      better = betterIdx.map(i => ({ hand: CAT[i], pct: Math.round((sim.oppCat[i] / sim.N * 100) * 10) / 10 }));
      const oa = outsAnalysis(hole, board);
      if (oa.turn) turnTable = { total: oa.turn.total, rows: tableRows(oa.turn.counts, oa.turn.total) };
      if (oa.river) riverTable = { total: oa.river.total, cumulative: board.length === 3, rows: tableRows(oa.river.counts, oa.river.total) };
    }

    if (call > 0) {
      const need = call / (pot + call);
      why = `You need ${(need * 100).toFixed(0)}% equity to break even calling ${call} into ${pot}. You have about ${(eq * 100).toFixed(0)}%.`;
      if (eq > need + 0.25 && eq > 0.6) rec = "RAISE"; else if (eq >= need + 0.03) rec = "CALL"; else if (eq >= need - 0.03 && board.length < 5) rec = "CALL"; else rec = "FOLD";
      if (rec === "CALL" && eq < need + 0.03) why += " It's marginal; drawing hands with future bets can justify it.";
    } else {
      if (eq > Math.max(0.6, fair + 0.2)) { rec = "BET"; why = `Well ahead of an even share (${(fair * 100).toFixed(0)}%). Bet for value, roughly half to two-thirds of the pot.` }
      else if (eq > fair + 0.08 && board.length < 5) { rec = "BET"; why = `Ahead of an even share (${(fair * 100).toFixed(0)}%). A modest bet builds the pot and denies free cards.` }
      else { rec = "CHECK"; why = `Not clearly ahead of an even share (${(fair * 100).toFixed(0)}%). Check and see the next card cheaply.` }
    }

    res.status(200).json({
      hole: hole.map(name),
      board: board.map(name),
      opponents: opps,
      equity: Math.round(eq * 1000) / 10,
      recommendation: rec,
      why,
      madeHand,
      better,
      turnTable,
      riverTable,
    });
  } catch (e) {
    console.error("advise handler exception", e);
    res.status(500).json({ error: "advise failed", detail: String(e) });
  }
}
