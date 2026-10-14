# shop.chapehsan.api

Express.js API for Chapehsan shop, connected to PostgreSQL (`chapehsan`).

## Setup

```bash
npm install
cp .env.example .env   # or create .env from sample below
npm run dev
```

## Environment

```
PORT=3000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=chapehsan
DB_USER=postgres
DB_PASSWORD=your_password
JWT_SECRET=change-me
JWT_EXPIRES_IN=7d
TELEGRAM_BOT_TOKEN=
TELEGRAM_ADMIN_IDS=123456789,987654321,555555555
```

## Telegram support bot

The Telegram bot runs in the API process and stores support requests in PostgreSQL. Create a bot with [@BotFather](https://t.me/BotFather), then set `TELEGRAM_BOT_TOKEN` in the server environment. Each administrator must open the bot and send `/start`; use `/id` in the bot to find that person's numeric Telegram ID, then put the IDs in `TELEGRAM_ADMIN_IDS` separated by commas. Add or remove IDs in that server setting to change the administrator list.

The bot supports `/requests`, `/reply <request-id> <message>`, and `/done <request-id>` for configured admins. Initial FAQ replies and Tehran business hours are in `src/services/telegram-bot.js`.

## Docs

Swagger UI: `http://localhost:3000/api-docs`
