-- Default Deepgram TTS voice → Olivia for all clinics.
UPDATE "clinic_settings"
SET "tts" = jsonb_set("tts", '{voice}', '"aura-2-olivia-es"')
WHERE "tts"->>'provider' = 'deepgram';
