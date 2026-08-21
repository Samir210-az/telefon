import 'dotenv/config';
import express from 'express';
import http from 'http';
import twilio from 'twilio';
import { attachMediaStreamServer } from './mediaStream.js';

const app = express();
app.use(express.urlencoded({ extended: false })); // Twilio form-urlencoded göndərir

const PORT = process.env.PORT || 3000;
const { VoiceResponse } = twilio.twiml;

// Sağlamlıq yoxlaması - Railway/brauzerdən sadəcə serverin ayaqda olduğunu görmək üçün
app.get('/', (req, res) => {
  res.send('SG AI Voice Agent işləyir.');
});

/**
 * Twilio bir nömrəyə zəng gələndə bu ünvana POST sorğusu göndərir.
 * Biz TwiML (Twilio-nun XML "təlimat dili") ilə cavab veririk:
 * "zəngi bu WebSocket ünvanına bağla" deyirik.
 *
 * Bu URL-i Twilio Console-da nömrənin "A call comes in" bölməsinə yazacaqsan:
 * https://<PUBLIC_HOSTNAME>/voice
 */
app.post('/voice', (req, res) => {
  const response = new VoiceResponse();
  const connect = response.connect();

  const host = process.env.PUBLIC_HOSTNAME;
  if (!host) {
    // PUBLIC_HOSTNAME doldurulmayıbsa xəbərdarlıq səsi ilə cavab veririk,
    // ki, səbəbsiz "zəng kəsilir" görünüşü yaranmasın.
    response.say(
      { language: 'en-US' },
      'Server configuration missing public hostname.'
    );
    res.type('text/xml').send(response.toString());
    return;
  }

  connect.stream({ url: `wss://${host}/media-stream` });
  res.type('text/xml').send(response.toString());
});

const server = http.createServer(app);
attachMediaStreamServer(server);

server.listen(PORT, () => {
  console.log(`Server ${PORT} portunda işə düşdü.`);
  console.log(`Twilio webhook: POST /voice`);
  console.log(`Media stream: wss://<host>/media-stream`);
});
