// Üç ayrı AI addımı: eşit (Whisper) -> düşün (Groq) -> danış (ElevenLabs).
// Hər biri ayrıca funksiyadır ki, sonra istəsən birini dəyişdirmək asan olsun
// (məs. Groq yerinə başqa model, ya da ElevenLabs yerinə başqa TTS).

import { pcm16ToWav, muLawBufferToPCM16 } from './audioUtils.js';

/**
 * Twilio-dan gələn mu-law səs bufferini Whisper-ə göndərib mətnə çevirir.
 */
export async function transcribeAudio(muLawBuffer, { language = 'az' } = {}) {
  const pcm = muLawBufferToPCM16(muLawBuffer);
  const wav = pcm16ToWav(pcm, 8000, 1);

  const form = new FormData();
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');
  form.append('model', 'whisper-1');
  form.append('language', language); // 'az' - Azərbaycan dilini məcburi göstəririk

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Whisper xətası (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return (data.text || '').trim();
}

/**
 * Söhbət tarixçəsi + yeni istifadəçi mesajı ilə Groq-dan cavab alır.
 * conversationHistory: [{ role: 'user'|'assistant', content: string }, ...]
 */
export async function getAgentReply(conversationHistory, userText) {
  const messages = [
    { role: 'system', content: process.env.AGENT_SYSTEM_PROMPT || 'Sən köməkçi AI-sən, Azərbaycan dilində qısa cavab ver.' },
    ...conversationHistory,
    { role: 'user', content: userText },
  ];

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
      messages,
      // Telefon danışığı üçün cavablar QISA olmalıdır - uzun cavab
      // gecikməni artırır və dinləyici üçün yorucu olur.
      // gpt-oss reasoning modelidir: düşüncə tokenləri də limitə daxildir.
      max_tokens: 400,
      reasoning_effort: 'low',
      temperature: 0.6,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groq xətası (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

/**
 * Mətni ElevenLabs ilə səsə çevirir. output_format=ulaw_8000 istəyirik ki,
 * Twilio-ya birbaşa, əlavə çevirmə olmadan geri göndərə bilək.
 * Qaytarır: Buffer (mu-law, 8kHz, mono) - Twilio media mesajına hazır.
 */
export async function synthesizeSpeech(text) {
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  const modelId = process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2';

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=ulaw_8000`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ElevenLabs xətası (${res.status}): ${errText}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
