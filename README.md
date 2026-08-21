# SG AI Voice Agent — başlanğıc versiyası

Telefon zəngini qəbul edib, canlı Azərbaycan dilində AI ilə cavablandıran server.

**Axın:** Zəng gəlir (Twilio) → səs Whisper-ə gedir (mətnə çevrilir) → mətn Groq-a gedir (AI cavab yaradır) → cavab ElevenLabs-ə gedir (səsə çevrilir) → səs geri zəngə axıdılır.

## Bu, hazır məhsul DEYİL — nəyi bilməlisən

- **Gecikmə real vaxtda test edilməyib.** Whisper + Groq + ElevenLabs ardıcıl çağırılır (paralel yox), bu, ümumi cavab vaxtını 2-4 saniyəyə qədər çıxara bilər. Söhbətimizdə danışdığımız "300-800ms insan-kimi sürət" bu versiyada YOXDUR — bu, sonrakı optimallaşdırma mərhələsidir.
- **Səssizlik detektoru (VAD) sadədir** — sadəcə səs həcminə baxır. Küylü mühitdə (kassa, küçə səsi) yanlış işləyə bilər. Test zamanı `audioUtils.js`-də `silenceThreshold` və `silenceFramesToEnd` dəyərlərini tənzimləmək lazım ola bilər.
- **"Sözü kəsmə" (barge-in) yoxdur** — AI danışarkən istifadəçi sözünü kəsə bilməz, AI bitirənə qədər gözləməli olacaq.
- **Twilio webhook imza doğrulaması əlavə edilməyib** — production-a keçəndə `/voice` endpoint-i hər kəs çağıra bilər. Bunu Twilio-nun `validateRequest` funksiyası ilə bağlamaq lazımdır (mən bunu tez edə bilərəm, sən əvvəlcə əsas axının işlədiyini görəndən sonra).
- **Flash v2.5 (ən sürətli ElevenLabs modeli) Azərbaycan dilini dəstəkləmir** (araşdırdığımız kimi) — ona görə `eleven_multilingual_v2` istifadə olunur, bu, Flash-dan yavaşdır.

Bunları bilə-bilə "bu, sınaq üçündür, canlı müştəriyə hələ yox" prinsipi ilə davam edirik.

## Qurulum addımları

### 1. Hesabları aç (əgər açmamısansa)
- platform.openai.com — API key al, balans yüklə
- console.groq.com — API key al
- elevenlabs.io — API key al, Voice Library-dən bir səs seç (ID-sini kopyala)
- console.twilio.com — Account SID + Auth Token götür, bir telefon nömrəsi al

### 2. Kodu köçür
```bash
git clone <bu repo-nun linki>
cd ai-voice-agent
npm install
cp .env.example .env
```
`.env` faylını aç, bütün `xxxxx` yerlərini öz açarlarınla doldur.

### 3. Lokal test (məcburi deyil, Railway-ə birbaşa keçə bilərsən)
```bash
npm run dev
```
Server `localhost:3000`-də işə düşəcək. Amma Twilio internetdən sənin lokal maşınına çata bilmədiyi üçün, real zəng testi üçün ya `ngrok` kimi tunel alətindən istifadə et, ya da birbaşa Railway-ə deploy et (aşağıda).

### 4. Railway-ə deploy
1. railway.app → "New Project" → "Deploy from GitHub repo" → bu repo-nu seç
2. "Variables" bölməsində `.env`-dəki bütün dəyişənləri əlavə et
3. Deploy bitəndə Railway sənə domen verəcək (məs. `xxx.up.railway.app`)
4. Bu domeni `.env`-də (Railway Variables-də) `PUBLIC_HOSTNAME` dəyişəninə yaz (https:// olmadan, sadəcə domen)

### 5. Twilio-nu bağla
1. console.twilio.com → Phone Numbers → aldığın nömrəni aç
2. "Voice Configuration" → "A call comes in" → "Webhook" seç
3. URL: `https://<railway-domenin>/voice`, metod: HTTP POST
4. Saxla

### 6. Test zəngi et
Twilio nömrəsinə zəng et. Salamlaşma səsini eşitməlisən, sonra danış, 2-4 saniyə sonra cavab gəlməlidir.

## Fayl strukturu

```
src/
  server.js       - Express server + Twilio webhook (/voice)
  mediaStream.js  - WebSocket handler, zəngin həyat dövrü
  ai.js           - Whisper, Groq, ElevenLabs çağırışları
  audioUtils.js   - mu-law <-> PCM çevirmə, səssizlik detektoru
```

## Növbəti addımlar (bunu işlədəndən sonra danışarıq)

- Gecikməni azaltmaq (paralel emal, streaming TTS)
- Twilio webhook təhlükəsizliyi (imza yoxlanışı)
- Real ssenari (klinika/şirniyyat üçün konkret system prompt + funksiya çağırışları — randevu yazmaq, sifariş qəbul etmək)
- Söhbət tarixçəsini verilənlər bazasında saxlamaq (hazırda yalnız yaddaşda, server yenidən başlayanda itir)
