import { WebSocketServer } from 'ws';
import { SilenceAwareBuffer } from './audioUtils.js';
import { transcribeAudio, getAgentReply, synthesizeSpeech } from './ai.js';

/**
 * Bir zəngin bütün ömrü boyu vəziyyətini saxlayan sinif.
 * Hər yeni zəng üçün ayrı instance yaradılır.
 */
class CallSession {
  constructor(ws) {
    this.ws = ws;
    this.streamSid = null;
    this.buffer = new SilenceAwareBuffer();
    this.history = []; // { role, content }[]
    this.isProcessing = false; // eyni anda 2 emalın üst-üstə düşməsinin qarşısını alır
  }

  async handleUtterance(muLawBuffer) {
    if (this.isProcessing) return; // hələ əvvəlki cavab hazırlanır, yenisini rədd et
    this.isProcessing = true;

    try {
      const userText = await transcribeAudio(muLawBuffer);
      if (!userText) {
        this.isProcessing = false;
        return; // boş/anlaşılmaz səs idi, cavab vermə
      }
      console.log(`[İstifadəçi] ${userText}`);

      const replyText = await getAgentReply(this.history, userText);
      console.log(`[AI] ${replyText}`);

      this.history.push({ role: 'user', content: userText });
      this.history.push({ role: 'assistant', content: replyText });
      // Tarixçəni məhdud saxla ki, hər sorğuda göndərilən mətn çoxalmasın
      if (this.history.length > 12) this.history = this.history.slice(-12);

      const audioBuffer = await synthesizeSpeech(replyText);
      this.sendAudioToTwilio(audioBuffer);
    } catch (err) {
      console.error('AI pipeline xətası:', err.message);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Sintez olunmuş mu-law audio-nu Twilio-ya kiçik hissələrlə göndərir.
   * QEYD: bu, sadə ardıcıl-göndərmədir, əsl 20ms real-vaxt pacing deyil -
   * başlanğıc üçün kifayətdir, amma "barge-in" (istifadəçi AI danışarkən
   * sözünü kəsə bilsin) funksiyası əlavə ediləndə bu hissə yenidən yazılmalıdır.
   */
  sendAudioToTwilio(muLawBuffer) {
    const CHUNK_SIZE = 8000; // ~1 saniyəlik mu-law audio 8kHz-də
    for (let offset = 0; offset < muLawBuffer.length; offset += CHUNK_SIZE) {
      const chunk = muLawBuffer.subarray(offset, offset + CHUNK_SIZE);
      this.ws.send(
        JSON.stringify({
          event: 'media',
          streamSid: this.streamSid,
          media: { payload: chunk.toString('base64') },
        })
      );
    }
  }
}

export function attachMediaStreamServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/media-stream' });

  wss.on('connection', (ws) => {
    console.log('Yeni zəng bağlantısı quruldu (WebSocket).');
    const session = new CallSession(ws);

    ws.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      switch (msg.event) {
        case 'start':
          session.streamSid = msg.start.streamSid;
          console.log(`Zəng başladı, streamSid=${session.streamSid}`);
          // Zəng başlayan kimi qısa salamlaşma səsləndiririk ki, sükut olmasın
          synthesizeSpeech(
            process.env.AGENT_GREETING || 'Salam, necə kömək edə bilərəm?'
          )
            .then((audio) => session.sendAudioToTwilio(audio))
            .catch((err) => console.error('Salamlaşma səsi xətası:', err.message));
          break;

        case 'media': {
          const muLawFrame = Buffer.from(msg.media.payload, 'base64');
          const { utteranceComplete, muLawBuffer } = session.buffer.push(muLawFrame);
          if (utteranceComplete) {
            session.handleUtterance(muLawBuffer);
          }
          break;
        }

        case 'stop':
          console.log('Zəng bitdi.');
          break;

        default:
          break;
      }
    });

    ws.on('close', () => {
      console.log('WebSocket bağlantısı bağlandı.');
    });

    ws.on('error', (err) => {
      console.error('WebSocket xətası:', err.message);
    });
  });

  return wss;
}
