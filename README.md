# Same Day Montana — Form Filler

Hosted web tool for filling Montana registration forms. Paste or upload title info, AI extracts the fields, download a filled PDF.

## Deploy to Vercel (one time)

### 1. Push to GitHub

```bash
cd samedaymontana-app
git init
git add .
git commit -m "init"
gh repo create samedaymontana-forms --private --push --source=.
```

Or create the repo manually on github.com/JoeKal97 and push.

### 2. Import into Vercel

1. Go to vercel.com → New Project
2. Import the `samedaymontana-forms` repo
3. Framework: **Other**
4. Root directory: leave as `/`
5. Click Deploy

### 3. Add environment variable

In Vercel project → Settings → Environment Variables:

```
ANTHROPIC_API_KEY = sk-ant-...your key...
```

Redeploy after adding.

### 4. Optional: custom domain

In Vercel → Domains → add `forms.samedaymontana.com` (or whatever subdomain you want).
Point a CNAME record at `cname.vercel-dns.com` in Namecheap.

---

## Adding new forms

1. Drop the blank PDF into the `/forms/` folder (e.g. `MV2.pdf`)
2. Add field mappings in `api/fill.js`
3. Add the tab button in `public/index.html`
4. `git push` — Vercel auto-deploys

## Local development

```bash
npm install
npx vercel dev
```

Open http://localhost:3000
