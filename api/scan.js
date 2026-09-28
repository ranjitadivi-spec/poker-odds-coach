// Vercel serverless function: keeps your Anthropic API key off the phone.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const code = process.env.APP_PASSCODE;
  if (code && req.headers["x-passcode"] !== code) return res.status(401).end();
  const image = req.body && req.body.image;
  if (!image || image.length > 4_000_000) return res.status(400).end();
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
    const j = await r.json();
    const text = (j.content || []).map(c => c.text || "").join("");
    const m = text.match(/\{[\s\S]*\}/);
    res.status(200).json(m ? JSON.parse(m[0]) : { hole: [], board: [] });
  } catch (e) {
    res.status(500).json({ error: "scan failed" });
  }
}
