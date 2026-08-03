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
```

## Docs

Swagger UI: `http://localhost:3000/api-docs`
