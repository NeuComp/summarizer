# Lab Notebook — Chemistry Video Summarizer

## What this is
- A frontend (`index.html`, `style.css`, `app.js`) — the lab-notebook UI.
- One serverless function (`netlify/functions/summarize.js`) that:
  1. Pulls the YouTube transcript (no YouTube API key needed).
  2. Sends it to Gemini with a prompt tuned for in-depth chemistry notes.
  3. Returns structured JSON the frontend renders as concept tiles, a summary, connections, and "don't forget" notes.
- Bookmarks save to your iPhone's Safari `localStorage` — private to that browser, no database needed.

## 1. Get a Gemini API key
Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey), create a key, and copy it.
**Important:** the model name `gemini-3.5-flash` you mentioned doesn't exist — that's likely why it's been erroring. Check the "Models" list in AI Studio for the exact current model name you have access to (commonly something like `gemini-2.0-flash` or a newer flash model). You'll set this below.

## 2. Push this folder to GitHub
```bash
cd chem-summarizer
git init
git add .
git commit -m "Initial commit"
```
Create a new empty repo on GitHub, then:
```bash
git remote add origin https://github.com/YOUR_USERNAME/chem-summarizer.git
git branch -M main
git push -u origin main
```

## 3. Deploy on Netlify
1. Go to [app.netlify.com](https://app.netlify.com) → **Add new site** → **Import an existing project**.
2. Connect GitHub, pick this repo.
3. Build settings: leave **Build command** empty, **Publish directory** = `.` (it's pre-filled by `netlify.toml`).
4. Before the first deploy (or right after), go to **Site configuration → Environment variables** and add:
   - `GEMINI_API_KEY` = the key from step 1
   - `GEMINI_MODEL` = the exact model name from AI Studio (optional — defaults to `gemini-2.0-flash` if you skip it)
5. Click **Deploy**.

Netlify will give you a URL like `https://your-site-name.netlify.app` — that's what you open on your iPhone. You can rename the site (Site configuration → Site details → Change site name) to get a nicer URL, and add it to your iPhone home screen via Safari's Share → "Add to Home Screen" so it feels like an app.

## 4. If it still says the model is "overloaded"
The function already retries automatically a couple of times before giving up — that's a Gemini-side rate limit on the free tier, not a bug in the code. If it persists, waiting a minute or switching `GEMINI_MODEL` to a different available flash model in your Netlify env vars usually fixes it.

## Notes / limits
- Only works on videos that have captions (auto-generated captions are fine).
- Very long videos get the transcript truncated to keep within the model's context — you'll see a note on the report when that happens.
- Nothing is stored server-side. Your saved summaries live only in the browser you saved them in.
