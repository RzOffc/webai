const { kv } = require('@vercel/kv');

const MILO_API   = 'https://api-miloai.vercel.app/api/aijahat';
const MILO_TOKEN = 'MILO-AI-BLACKS3X';
const MAX_CTX    = 20; // pasang pesan yang dibawa sebagai konteks

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  /* ── GET  /api/chat?session=xxx  ──────────────────── */
  if (req.method === 'GET') {
    const session = String(req.query.session || 'default').slice(0, 80);
    try {
      const history = (await kv.get('chat:' + session)) || [];
      return res.status(200).json({ ok: true, session, history });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  /* ── POST /api/chat  ──────────────────────────────── */
  if (req.method === 'POST') {
    const message = String((req.body || {}).message || '').trim();
    const session = String((req.body || {}).session || 'default').slice(0, 80);

    if (!message) {
      return res.status(400).json({ ok: false, error: 'message wajib diisi' });
    }

    try {
      let history = (await kv.get('chat:' + session)) || [];

      // Bangun prompt dengan konteks riwayat
      let prompt = message;
      if (history.length > 0) {
        const ctx = history
          .slice(-(MAX_CTX * 2))
          .map(m => (m.role === 'user' ? 'User: ' + m.text : 'AI: ' + m.text))
          .join('\n');
        prompt =
          'Berikut riwayat percakapan kita sebelumnya:\n' + ctx +
          '\n\nUser: ' + message +
          '\n\nLanjutkan percakapan dengan mengingat konteks di atas.';
      }

      // Panggil Milo-AI
      const miloRes = await fetch(
        MILO_API + '?text=' + encodeURIComponent(prompt) + '&token=' + MILO_TOKEN
      );
      if (!miloRes.ok) {
        return res.status(502).json({ ok: false, error: 'Milo API error ' + miloRes.status });
      }
      const miloJson = await miloRes.json();
      if (!miloJson.status || !miloJson.result) {
        return res.status(502).json({ ok: false, error: 'Milo API tidak mengembalikan hasil' });
      }

      const reply = miloJson.result;

      // Update & simpan riwayat (TTL 30 hari)
      history.push({ role: 'user', text: message, ts: Date.now() });
      history.push({ role: 'ai',   text: reply,   ts: Date.now() });
      if (history.length > MAX_CTX * 4) {
        history = history.slice(-(MAX_CTX * 4));
      }
      await kv.set('chat:' + session, history, { ex: 2592000 }); // 30 hari

      return res.status(200).json({
        ok:    true,
        reply,
        count: history.length
      });

    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  /* ── DELETE /api/chat?session=xxx  ───────────────── */
  if (req.method === 'DELETE') {
    const session = String(req.query.session || 'default').slice(0, 80);
    try {
      await kv.del('chat:' + session);
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
};
