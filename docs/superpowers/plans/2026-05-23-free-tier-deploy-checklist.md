# Free-Tier Deploy Checklist

Deploy clinic-translator on **$0 fixed hosting** with Deepgram pay-per-use for voice.

## Prerequisites

- [Neon](https://neon.tech) free Postgres project
- [Vercel](https://vercel.com) Hobby account
- [Deepgram](https://deepgram.com) API key (STT + TTS)
- [OpenAI](https://platform.openai.com) API key (dev translate) **or** AWS Bedrock keys (prod presets)

## Vercel environment variables

Set for **Production** and **Preview**:

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | Neon pooled connection string |
| `DIRECT_URL` | Neon direct connection (migrations) |
| `NEXTAUTH_URL` | `https://your-app.vercel.app` |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
| `DEEPGRAM_API_KEY` | Deepgram project key |
| `OPENAI_API_KEY` | OpenAI key (dev preset translate) |
| `GOOGLE_CLIENT_ID` | Google OAuth client (if not using dev-login) |
| `GOOGLE_CLIENT_SECRET` | Google OAuth secret |
| `CLINIC_EMAIL_ALLOWLIST` | e.g. `*@yourclinic.com` |

Optional (production presets with Claude):

| Variable | Value |
|----------|-------|
| `AWS_REGION` | e.g. `us-east-1` |
| `AWS_ACCESS_KEY_ID` | IAM key with Bedrock access |
| `AWS_SECRET_ACCESS_KEY` | IAM secret |
| `BEDROCK_MODEL_ID` | e.g. `anthropic.claude-haiku-4-5-v1:0` |

## Deploy steps

```bash
npm run db:migrate          # against Neon DIRECT_URL
vercel --prod
```

## Post-deploy smoke test

1. Open `https://your-app.vercel.app/app` (HTTPS required for mic).
2. Log in (Google OAuth or dev-login if enabled).
3. Start a session, speak Spanish — transcript should appear.
4. Type English reply, send — Spanish audio should play (`x-tts-voice: aura-2-javier-es` in network tab).

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| TTS 401/403 | Confirm Deepgram key has Aura TTS enabled |
| Mic blocked | Must use HTTPS (Vercel provides this) |
| STT silent | Check `DEEPGRAM_API_KEY` and browser mic permission |
| Translate fails | Set `OPENAI_API_KEY` (dev) or Bedrock keys (prod presets) |

## Estimated monthly cost (light use)

| Service | Cost |
|---------|------|
| Vercel Hobby | $0 |
| Neon Free | $0 |
| Deepgram STT+TTS | ~$30–80/mo at ~50 calls/day |
| OpenAI translate | ~$5–15/mo |
