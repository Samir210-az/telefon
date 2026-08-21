// Twilio Media Streams səsi 8kHz, mono, mu-law (G.711) formatında göndərir.
// Whisper isə WAV/MP3 kimi standart fayl formatı gözləyir.
// Bu fayl bu ikisi arasında çevirməni edir, üstəlik "danışıq bitdimi?" sualına
// cavab verən sadə enerji-əsaslı səssizlik detektoru (VAD) daxildir.

// ITU-T G.711 mu-law dekod cədvəli (standart alqoritm)
const MULAW_DECODE_TABLE = new Int16Array(256);
(function buildMuLawTable() {
  for (let i = 0; i < 256; i++) {
    let muVal = ~i & 0xff;
    let sign = muVal & 0x80;
    let exponent = (muVal >> 4) & 0x07;
    let mantissa = muVal & 0x0f;
    let sample = ((mantissa << 3) + 0x84) << exponent;
    sample -= 0x84;
    MULAW_DECODE_TABLE[i] = sign ? -sample : sample;
  }
})();

/**
 * Twilio-dan gələn mu-law bufferini 16-bit PCM-ə çevirir (Whisper üçün lazımdır)
 */
export function muLawBufferToPCM16(muLawBuffer) {
  const pcm = Buffer.alloc(muLawBuffer.length * 2);
  for (let i = 0; i < muLawBuffer.length; i++) {
    const sample = MULAW_DECODE_TABLE[muLawBuffer[i]];
    pcm.writeInt16LE(sample, i * 2);
  }
  return pcm;
}

/**
 * Xam PCM16 datanı Whisper-in oxuya biləcəyi tam WAV faylına bükür
 */
export function pcm16ToWav(pcmBuffer, sampleRate = 8000, numChannels = 1) {
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmBuffer.length;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM alt-blokun ölçüsü
  header.writeUInt16LE(1, 20); // audio format = PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBuffer]);
}

/**
 * Sadə enerji-əsaslı VAD (voice activity detection).
 * Twilio 20ms-lik mu-law çərçivələr göndərir (160 bayt / çərçivə).
 * Hər çərçivəni PCM-ə çevirib orta amplitudunu ölçürük.
 *
 * Bu, peşəkar VAD (məs. WebRTC VAD) qədər dəqiq deyil, amma başlanğıc üçün
 * kifayət qədər işlək bir yanaşmadır. Real istifadədə "danışıq erkən kəsilir"
 * və ya "səssizlik kifayət qədər tez tanınmır" kimi problemlər çıxarsa,
 * SILENCE_THRESHOLD və SILENCE_FRAMES_TO_END dəyərlərini tənzimləmək lazımdır.
 */
export class SilenceAwareBuffer {
  constructor({
    silenceThreshold = 500, // orta mütləq amplitud bundan aşağıdırsa "səssizlik"
    silenceFramesToEnd = 35, // ~35 * 20ms = 700ms davamlı səssizlik = danışıq bitdi
    minSpeechFrames = 8, // ~160ms-dən qısa "danışıq" səs-küy sayılıb rədd edilir
  } = {}) {
    this.silenceThreshold = silenceThreshold;
    this.silenceFramesToEnd = silenceFramesToEnd;
    this.minSpeechFrames = minSpeechFrames;
    this.reset();
  }

  reset() {
    this.frames = [];
    this.speechFrameCount = 0;
    this.silenceFrameCount = 0;
    this.hasSpeechStarted = false;
  }

  /**
   * Yeni mu-law çərçivə əlavə edir.
   * Qaytarır: { utteranceComplete: bool, muLawBuffer: Buffer|null }
   */
  push(muLawFrame) {
    const pcm = muLawBufferToPCM16(muLawFrame);
    let sum = 0;
    const sampleCount = pcm.length / 2;
    for (let i = 0; i < pcm.length; i += 2) {
      sum += Math.abs(pcm.readInt16LE(i));
    }
    const avgAmplitude = sum / sampleCount;

    this.frames.push(muLawFrame);

    if (avgAmplitude > this.silenceThreshold) {
      this.hasSpeechStarted = true;
      this.speechFrameCount++;
      this.silenceFrameCount = 0;
    } else if (this.hasSpeechStarted) {
      this.silenceFrameCount++;
    }

    const utteranceComplete =
      this.hasSpeechStarted &&
      this.silenceFrameCount >= this.silenceFramesToEnd &&
      this.speechFrameCount >= this.minSpeechFrames;

    if (utteranceComplete) {
      const combined = Buffer.concat(this.frames);
      this.reset();
      return { utteranceComplete: true, muLawBuffer: combined };
    }

    return { utteranceComplete: false, muLawBuffer: null };
  }
}
