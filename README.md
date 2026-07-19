# Student Attendance Tracker PWA (Google Sheets Backend)

A complete, production-ready **Progressive Web App (PWA)** for teachers to mark daily classroom attendance across multiple batches and subjects. Powered by a **Google Sheets + Google Apps Script Web App** backend with full **IndexedDB offline queuing and automatic synchronization**.

---

## 🏗️ Architecture & Features

- **📱 Mobile-First PWA**: Installable onto iOS (`Safari -> Add to Home Screen`) and Android (`Chrome -> Install App`) devices with zero app store overhead.
- **🎨 Daylight Readability & Modern Aesthetics**: High-contrast status color tokens (Emerald Green, Crimson Red, Amber Gold) with large touch targets ($\ge 44\text{px}$) and glassmorphic cards.
- **⚡ Offline First (`db.js`)**: If internet or cell service drops in a classroom during submission, attendance is stored locally inside the phone's **IndexedDB (`pendingSync`)** and synced silently in the background when connection returns.
- **📊 Real-Time Analytics**: Built-in Student and Subject Reports that compute exact attendance rates where `Percentage = Present / (Present + Absent) * 100` (explicitly excluding `Leave` days from the denominator).

---

## 🚀 Quick Setup Guide

### 1️⃣ Step 1: Initialize Your Google Sheet Database
1. Go to [Google Sheets](https://sheets.google.com/) and create a new blank spreadsheet titled **`Student Attendance Database`**.
2. From the top menu, navigate to **`Extensions` $\rightarrow$ `Apps Script`**.
3. In the Apps Script editor:
   - Paste the contents of [`../backend/Code.gs`](file:///c:/Users/rabee/Desktop/attendance-track/backend/Code.gs) into the default `Code.gs` file.
   - Click the **`+` (Add a file)** button next to Files, select **Script**, name it `setup`, and paste the contents of [`../backend/setup.gs`](file:///c:/Users/rabee/Desktop/attendance-track/backend/setup.gs) into `setup.gs`.
4. At the top of the Apps Script editor, select the function **`createInitialSheets`** from the dropdown and click **▶ Run**.
   - Review and accept the Google authorization prompts (`Review Permissions` $\rightarrow$ `Advanced` $\rightarrow$ `Go to script (unsafe)` $\rightarrow$ `Allow`).
   - *Result*: Your spreadsheet will now have 5 formatted tabs (`Students`, `Batches`, `Subjects`, `Attendance`, `Config`) pre-populated with 15 sample students (`B1` and `B2`).

---

### 2️⃣ Step 2: Deploy Google Apps Script as a Web App
1. Inside your Apps Script editor, click the blue **Deploy** button in the top right corner $\rightarrow$ select **New deployment**.
2. Click the gear icon ($\text{Select type}$) next to "Select type" and choose **Web app**.
3. Fill in the deployment settings precisely:
   - **Description**: `Attendance API v1`
   - **Execute as**: `Me (your@email.com)` *(CRITICAL: Must be "Me")*
   - **Who has access**: `Anyone` *(CRITICAL: Must be "Anyone" so the PWA can fetch data without requiring Google login)*
4. Click **Deploy**.
5. Copy the **Web App URL** provided (`https://script.google.com/macros/s/AKfycbz.../exec`).

---

### 3️⃣ Step 3: Configure `config.js`
1. Open [`js/config.js`](file:///c:/Users/rabee/Desktop/attendance-track/attendance-app/js/config.js) in a code editor or text editor.
2. Replace `API_BASE_URL` with your copied Web App URL:
   ```javascript
   window.CONFIG = {
     API_BASE_URL: 'https://script.google.com/macros/s/AKfycb.../exec',
     API_TOKEN: 'SLAQ_SECRET_2026', // Must match the value in your Config sheet tab
     DEFAULT_PIN: '1234'             // Matches Config sheet tab PIN
   };
   ```

---

### 4️⃣ Step 4: Hosting the Static PWA Files
Since this project consists entirely of plain HTML, CSS, and JavaScript with no build steps (`npm run build` is not required), you can host it anywhere for free!

#### Option A: Local Testing (HTTP Server)
To test on your computer immediately:
```bash
# Using Python
python -m http.server 8080

# Or using Node serve
npx serve .
```
Then open `http://localhost:8080` in Chrome or Safari.

#### Option B: GitHub Pages (Free Cloud Hosting)
1. Push the `attendance-app` folder to a GitHub repository.
2. Go to **Settings $\rightarrow$ Pages**.
3. Under **Branch**, select `main` and set folder to `/ (root)` or `/attendance-app/` depending on repo structure.
4. Click **Save**. Your PWA is now live at `https://yourusername.github.io/attendance-app/`!

---

### 5️⃣ Step 5: Installing on Mobile Devices ("Add to Home Screen")

#### On iPhone / iPad (iOS Safari)
1. Open your hosted PWA link in **Safari**.
2. Tap the **Share** icon (square with upward arrow at the bottom of the screen).
3. Scroll down and tap **Add to Home Screen**.
4. Tap **Add** in the top right corner. You now have a native `SLAQ Attendance` icon on your home screen!

#### On Android (Google Chrome)
1. Open your hosted PWA link in **Google Chrome**.
2. Tap the **Three Dots (Menu)** in the top right corner.
3. Tap **Install app** or **Add to Home screen**.
4. Confirm installation. The app will install with offline service worker caching active immediately!

---

## 🧪 Testing the Offline Sync Workflow
1. Open the app while online and log in (`PIN: 1234`).
2. Go to **Class Session Setup** and select `Batch A (Standard B1)` and `Mathematics`.
3. Click **Start Marking $\rightarrow$**.
4. **Turn on Airplane Mode** or turn off Wi-Fi in browser DevTools (`Network -> Offline`).
5. Mark student statuses (`🟢 Present`, `🔴 Absent`, `🟡 Leave`) and click **Save Attendance & Sync**.
6. Notice that the app saves the data locally inside **IndexedDB (`pendingSync`)** and displays a persistent orange banner at the top: `1 unsynced record saved offline`.
7. **Turn off Airplane Mode** (reconnect to internet).
8. Notice the app automatically detects network restoration (`window.addEventListener('online')`), pushes the saved records to Google Sheets, and updates the banner to green: `All records synced with Google Sheets!`.

---

## 📁 Directory Structure
```
/attendance-track
  ├── backend/
  │    ├── Code.gs             # Single-file Google Apps Script REST Web App
  │    └── setup.gs            # Automatic 1-click sheet & sample data initializer
  └── attendance-app/
       ├── index.html          # Semantic Single Page Application (SPA) screens
       ├── manifest.json       # PWA manifest (standalone mode & icon definitions)
       ├── service-worker.js   # Offline cache & smart API bypass strategy
       ├── README.md           # Setup & deployment manual
       ├── css/
       │    └── style.css      # High-contrast classroom UI system & responsive layout
       ├── js/
       │    ├── config.js      # API constants (URL & secret token)
       │    ├── api.js         # Fetch wrapper with CORS optimization & error tracking
       │    ├── db.js          # IndexedDB offline storage & queue flushing logic
       │    └── app.js         # SPA router, state management, and counter logic
       └── icons/
            ├── icon-192.png   # 192x192 PWA install icon
            └── icon-512.png   # 512x512 PWA install icon
```
