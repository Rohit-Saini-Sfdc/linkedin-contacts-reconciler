# 📇 LinkedIn Contact Reconciler & Sync

A Chrome extension for macOS that bridges your **LinkedIn profile browsing in Chrome** with **Google Contacts** and **iPhone Contacts**.

When viewing any LinkedIn contact profile (`https://www.linkedin.com/in/*`), this extension allows you to link the profile, take relationship notes, and sync everything directly to your Google Contacts and native iPhone Contacts App.

---

## ✨ Features

- **LinkedIn Profile Auto-Detection**: Automatically parses LinkedIn profile handles and full names (`Jessie Grenfell`).
- **Seamless Contact Reconciliation**:
  - **Auto-Link Detection**: Automatically recognizes previously linked contacts on page load, turns the button **GREEN** (`✓ Linked: Name`), and loads all existing notes.
  - **Search & Match**: Search all Google Contacts by name/email and link with 1 click without losing existing notes.
  - **Create New Contact**: Create a new Google Contact formatted with First Name, Last Name, Job Title, and LinkedIn URL.
- **Custom `LinkedIn` URL Label**: Saves LinkedIn URLs under the explicit custom label **`LinkedIn`** in Google Contacts for clean formatting.
- **Relationship Notes (iPhone Sync)**: Single, spacious relationship notes text box that syncs directly to Google Contacts biography and renders on iOS Contacts under "Notes".
- **Dual OAuth Authentication**: Supports native Chrome extension OAuth (`chrome.identity.getAuthToken`) and web OAuth fallback (`chrome.identity.launchWebAuthFlow`).
- **Interactive Diagnostics Panel**: Built-in diagnostics view in extension popup displaying Extension ID, Redirect URI, and Client ID status.

---

## 📁 Repository Structure

```text
Contacts/
├── manifest.json.example   # Sanitized extension manifest template
├── background.js           # Service worker handling OAuth & Google People API calls
├── content.js              # Content script injecting UI & scraping LinkedIn DOM
├── styles.css              # Glassmorphism overlay UI styles for LinkedIn
├── lib/
│   ├── googlePeopleApi.js  # Client helper for Google People API v1
│   └── noteParser.js       # Notes formatting and parsing utility
├── popup/
│   ├── popup.html          # Extension toolbar popup interface
│   └── popup.js            # Popup authentication & diagnostics controller
├── .gitignore              # Ignores local manifest.json with actual Client ID
└── README.md               # Project documentation & setup guide
```

---

## 🛠️ Installation & Setup Guide

### 1. Clone Repository & Setup Manifest

```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
cd YOUR_REPOSITORY
cp manifest.json.example manifest.json
```

---

### 2. Configure Google Cloud OAuth 2.0 Credentials

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (e.g., `Contacts-Reconciler`).
3. Enable the **Google People API** under **APIs & Services > Library**.
4. Configure the **OAuth Consent Screen**:
   - Set User Type to **External**.
   - Add your Gmail address under **Test users**.
5. Go to **APIs & Services > Credentials** and click **Create Credentials > OAuth client ID**:
   - **Application Type**: **Web Application** (Recommended for unpacked extensions) or **Chrome Extension**.
   - **Authorized redirect URIs**: Add `https://<your-extension-id>.chromiumapp.org/`.
6. Copy the generated **Client ID** (ends with `.apps.googleusercontent.com`).

---

### 3. Add Client ID to `manifest.json`

Open your local `manifest.json` and replace `YOUR_GOOGLE_CLIENT_ID`:

```json
"oauth2": {
  "client_id": "YOUR_ACTUAL_CLIENT_ID.apps.googleusercontent.com",
  "scopes": [
    "https://www.googleapis.com/auth/contacts"
  ]
}
```

> **Note**: `manifest.json` is included in `.gitignore` so your private Client ID will remain strictly on your local machine and won't be pushed to GitHub.

---

### 4. Load Unpacked Extension in Chrome

1. Open Google Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** in the top-right corner.
3. Click **Load unpacked** in the top-left and select this project directory.
4. Click the extension toolbar icon and click **Sign In with Google**.

---

## 🚀 How to Use

1. Open any profile on LinkedIn (e.g., `https://www.linkedin.com/in/username/`).
2. A floating button **`📇 Reconcile Contact`** will appear on the top right (and in the profile action bar).
3. Click the button to open the side panel:
   - **If Linked**: Edit notes and click **Save to Google & iPhone**.
   - **If Unlinked**: Select an existing contact from search results or click **➕ Create New Contact**.
4. Open your **iPhone Contacts App** — the linked contact will show the LinkedIn URL labeled **LinkedIn** and all relationship notes under **Notes**!

---

## 📄 License

MIT License. Free to use, modify, and distribute.
