# HK Resource Planner

Resource planning and project P&L tool. Next.js (App Router) + TypeScript + Tailwind CSS, backed by Supabase.

## Stack

- Next.js 15 / React 19 / TypeScript
- Tailwind CSS (original hand-written styles preserved in `src/app/globals.css`)
- Supabase (`@supabase/supabase-js`) for data, called from Next.js Server Actions in `src/app/actions.ts`
- `xlsx` for the Excel export

## Local development

```bash
npm install
npm run dev
```

Requires `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local`.
