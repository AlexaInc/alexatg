---
title: SysSync Core V1
emoji: 🚀
colorFrom: blue
colorTo: green
sdk: docker
app_port: 7860
pinned: false
---

# SysSync Core V1

System Synchronization API Service.

## Configuration

Set these as Space **secrets** (or provide `ENV_FILE_CONTENT` with the full file
content as a single secret):

| Variable | Required | Description |
| --- | --- | --- |
| `BOT_TOKEN` | yes | Main service token |
| `botOWNER_IDS` | yes | Comma-separated owner ids |
| `mongouri` | yes | Primary MongoDB connection string |
| `SECONDARY_BOT_TOKEN` | no | Secondary service token |
| `SECONDARY_MONGO_URI` | no | Secondary MongoDB connection string |
| `DATING_MONGO_URI` | no | Dating module MongoDB connection string |
| `logGrpid` | no | Log group id |
| `API_ID` / `API_HASH` | no | MTProto app credentials (defaults are bundled) |
| `DEEPAI_API_KEY` | no | AI engine key (free `tryit-…` key works) |
| `POSTGRES_URL` | no | PostgreSQL for the AI engine memory (e.g. free Neon/Supabase) |

## AI features

The chatbot is powered by the `alexa-ai` engine: DeepAI-backed conversation
with long-term memory per person, per-group conversation threads and image
understanding (reply to a photo with `/ai <question>`). Set `DEEPAI_API_KEY`
and `POSTGRES_URL` to enable it; without them the rest of the service runs
normally and `/ai` reports that the AI is not configured.
