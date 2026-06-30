const { YoutubeTranscript } = require('youtube-transcript');

const MAX_TRANSCRIPT_CHARS = 30000;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtube\.com\/embed\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/,
    /youtu\.be\/([A-Za-z0-9_-]{11})/
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

async function fetchVideoMeta(videoId) {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
    );
    if (!res.ok) return { title: 'Untitled video', thumbnail: null };
    const data = await res.json();
    return {
      title: data.title || 'Untitled video',
      thumbnail: data.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
    };
  } catch {
    return { title: 'Untitled video', thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` };
  }
}

async function fetchTranscript(videoId) {
  const segments = await YoutubeTranscript.fetchTranscript(videoId);
  let text = segments.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim();
  let truncated = false;
  if (text.length > MAX_TRANSCRIPT_CHARS) {
    text = text.slice(0, MAX_TRANSCRIPT_CHARS);
    truncated = true;
  }
  return { text, truncated };
}

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    topic: { type: 'string', description: 'The core chemistry topic of the video, in a few words' },
    keyConcepts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'A short 2-4 letter tile symbol, periodic-table style, e.g. "Ox" for oxidation' },
          term: { type: 'string' },
          explanation: { type: 'string', description: '1-3 sentences, can go into real depth, do not oversimplify' }
        },
        required: ['symbol', 'term', 'explanation']
      }
    },
    summary: {
      type: 'string',
      description: 'A thorough multi-paragraph summary of the video content, written for a learner who wants real depth, not a dumbed-down version'
    },
    connections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          concept: { type: 'string' },
          relatedTo: { type: 'string' },
          why: { type: 'string', description: 'Why these two ideas connect' }
        },
        required: ['concept', 'relatedTo', 'why']
      }
    },
    importantNotes: {
      type: 'array',
      items: { type: 'string' },
      description: 'Things the video flags as especially important, easy to mix up, or commonly tested'
    }
  },
  required: ['topic', 'keyConcepts', 'summary', 'connections', 'importantNotes']
};

function buildPrompt(title, transcriptText, truncated) {
  return `You are a chemistry tutor helping a student study from a YouTube video transcript.

Video title: "${title}"

Transcript${truncated ? ' (truncated to the first portion of the video)' : ''}:
"""
${transcriptText}
"""

Produce study notes a motivated student can actually learn from. Go into real depth on the chemistry, don't oversimplify or water concepts down, but explain things clearly. For each key concept, also note how it relates to other chemistry ideas (even ones not explicitly in the video) so the student sees the bigger picture. Flag anything the video treats as especially important or commonly confused.`;
}

async function callGemini(apiKey, prompt, attempt = 1) {
  const maxAttempts = 3;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.4
      }
    })
  });

  if (res.status === 503 || res.status === 429) {
    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, attempt * 1500));
      return callGemini(apiKey, prompt, attempt + 1);
    }
    throw new Error('OVERLOADED');
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`GEMINI_ERROR: ${res.status} ${errBody}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('EMPTY_RESPONSE');
  return JSON.parse(text);
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { url } = body;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server is missing GEMINI_API_KEY. Set it in Netlify > Site configuration > Environment variables.' })
    };
  }
  if (!url) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing url' }) };
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "That doesn't look like a valid YouTube link." }) };
  }

  try {
    const [meta, transcriptResult] = await Promise.all([
      fetchVideoMeta(videoId),
      fetchTranscript(videoId)
    ]);

    if (!transcriptResult.text) {
      return {
        statusCode: 422,
        headers,
        body: JSON.stringify({ error: 'This video has no captions available, so it can\u2019t be summarized.' })
      };
    }

    const prompt = buildPrompt(meta.title, transcriptResult.text, transcriptResult.truncated);
    const result = await callGemini(apiKey, prompt);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        videoId,
        title: meta.title,
        thumbnail: meta.thumbnail,
        truncated: transcriptResult.truncated,
        ...result
      })
    };
  } catch (err) {
    const message = String(err.message || err);
    if (message.includes('OVERLOADED')) {
      return {
        statusCode: 503,
        headers,
        body: JSON.stringify({ error: 'The AI model is overloaded right now. Wait a moment and try again.' })
      };
    }
    if (message.toLowerCase().includes('transcript')) {
      return {
        statusCode: 422,
        headers,
        body: JSON.stringify({ error: 'Couldn\u2019t fetch a transcript for this video. It may not have captions.' })
      };
    }
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Something went wrong while summarizing.', detail: message })
    };
  }
};
