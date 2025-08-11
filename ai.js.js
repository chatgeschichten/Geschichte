// Netlify Function: OpenAI‑Proxy für das KI‑Text‑Adventure
// Wichtig: In Netlify → Site settings → Environment variables:
//   OPENAI_API_KEY = dein geheimer Key

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const { mode, style, setting, seed, history, payload } = JSON.parse(event.body || '{}');

    const sys = buildSystemPrompt({ mode, style, setting });

    // Wir senden nur eine knappe Historie (letzte 8 Züge), um Kosten gering zu halten
    const recent = Array.isArray(history) ? history.slice(-8) : [];

    const userMsg = buildUserMessage({ history: recent, payload });

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.9,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: userMsg }
        ]
      })
    });

    if (!r.ok) {
      const t = await r.text();
      throw new Error('OpenAI Fehler: '+t);
    }

    const json = await r.json();
    const text = json.choices?.[0]?.message?.content || '';

    // Wir erwarten strikt JSON. Falls nicht, versuchen wir zu parsen.
    const safe = extractJson(text);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(safe)
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
}

function buildSystemPrompt({ mode, style, setting }) {
  return `Du bist ein interaktiver Story-Prozessor für ein Chat-UI im WhatsApp-Dark-Stil.
REGELN (wichtig!):
1) ANTOWRTE AUSSCHLIESSLICH ALS JSON-OBJEKT ohne Erklärtext.
2) Der Chat zeigt drei Rollen:
   - narrator: erzählt Szenen/Atmosphäre (kursiv, mittig)
   - character: Figur spricht (mit name)
   - you: wird NICHT von dir erzeugt
3) Fragen an den Spieler werden NICHT als Chatnachricht gestellt. Lege stattdessen Buttons unter dem Chat an.
4) Nutze kurze, mobile-geeignete Nachrichten. Deutsch. Klar, emotional, cliffhangerbereit.
5) Pro Zug: 1–3 Nachrichten (MIX aus narrator und character), dann 2–4 Entscheidungen.
6) Gib IMMER das Feld progress (0–100). Steigere es moderat.
7) Vermeide harte/sexuelle Inhalte und halte dich an jugendfreundliche Richtlinien.
8) Stil: ${style||'Realistisch'}. Setting: ${setting||'Offen'}. Modus: ${mode||'adventure'}.
AUSGABEFORMAT:
{
  "messages": [ {"role":"narrator"|"character", "text":"...", "name":"optional"}, ... ],
  "choices": [ {"id":"string","label":"Knapp & klar"}, ... ],
  "progress": 10
}`;
}

function buildUserMessage({ history, payload }) {
  const h = history.map(t => ({ you: t.you || null, choiceId: t.choiceId || null, ai: t.ai || null }));
  return JSON.stringify({
    event: payload?.start ? 'start' : (payload?.choiceId ? 'choice' : 'user'),
    choiceId: payload?.choiceId || null,
    userText: payload?.userText || null,
    history: h
  });
}

function extractJson(text){
  // Versuche reines JSON zu parsen; ansonsten JSON-Block herausschneiden
  try { return JSON.parse(text); } catch {}
  const m = text.match(/\{[\s\S]*\}$/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  // Fallback: minimale Struktur
  return { messages:[{role:'narrator', text:'(Fehler beim KI-Format. Versuche es erneut.)'}], choices:[{id:'retry', label:'Nochmal'}], progress:10 };
}