# Q Store demo

A clickable demo of the **Jimboomba Scout Group Q Store**, where equipment is booked out to leaders and activities, issued against the booking, and booked back in. It runs in the browser on sample data, with the same screens and rules as the real app.

The real Q Store is the Python app that runs on the Windows PC at the hall. This demo is for showing people how it works.

Sign in as the Quartermaster to try **Stocktake** (scan and count the store, then sign off the differences) and **Reports** (printable equipment register, items on issue, overdue items, damage and losses, the audit trail and stocktake reports).

**Demo PINs:** Quartermaster `1234`, any leader `1111`. Changes stay in each person's own browser. The yellow bar has a **Reset demo** button.

## What's in here

| Path | What it is |
|---|---|
| `src/App.jsx` | React screens: dashboard, bookings, issue, return, availability, equipment, repairs, leaders, log, voucher, labels |
| `src/Audit.jsx` | Stocktake (count, review, sign off) and printable audit reports |
| `src/audit.js` | Stocktake rules (mirrors `qstore/audit.py` in the Python app) |
| `src/store.js` | Data, store rules and sample data (mirrors `qstore/db.py` in the Python app) |
| `src/qstore.css` | Styles |
| `build.mjs` | Builds `dist/index.html`, one self-contained page |
| `.github/workflows/deploy.yml` | Publishes the demo to GitHub Pages on every push to `main` |

## Run it on your computer

Install [Node.js](https://nodejs.org) (the LTS version), then in this folder:

```
npm install
npm start
```

This builds the page and opens it at http://localhost:3000. Use `npm run build` to only build `dist/index.html`.

## Put it on GitHub and host it

1. On github.com, click **New repository**. Name it e.g. `qstore-demo`. Leave it empty: no README, .gitignore or licence.
2. In this folder, run:
   ```
   git init -b main
   git add .
   git commit -m "Q Store demo"
   git remote add origin https://github.com/YOUR-USERNAME/qstore-demo.git
   git push -u origin main
   ```
   If you'd rather not use the command line, GitHub Desktop works too: **File → Add local repository**, choose this folder, then **Publish repository**.
3. In the repository on GitHub, open **Settings → Pages**. Under **Build and deployment → Source**, choose **GitHub Actions**.
4. Open the **Actions** tab. The *Deploy to GitHub Pages* run takes about a minute. If it ran before step 3 and failed, click it and choose **Re-run all jobs**.
5. The demo is live at `https://YOUR-USERNAME.github.io/qstore-demo/`.

After that, every push to `main` updates the live demo automatically.

GitHub Pages is free for public repositories. A private repository needs a paid GitHub plan to use Pages.
