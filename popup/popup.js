document.addEventListener("DOMContentLoaded", async () => {
  const launchPanelBtn = document.getElementById("launch-panel-btn");
  const authBtn = document.getElementById("auth-btn");
  const authWebBtn = document.getElementById("auth-web-btn");
  const signoutBtn = document.getElementById("signout-btn");


  if (launchPanelBtn) {
    launchPanelBtn.addEventListener("click", async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;

      // Send message or inject on demand
      chrome.tabs.sendMessage(tab.id, { type: "OPEN_RECONCILER" }, async (res) => {
        if (chrome.runtime.lastError || !res) {
          try {
            await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["styles.css"] });
            await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["lib/noteParser.js", "content.js"] });
            setTimeout(() => {
              chrome.tabs.sendMessage(tab.id, { type: "OPEN_RECONCILER" });
            }, 300);
          } catch (e) {
            showError(`Could not inject on current page: ${e.message}`);
          }
        }
      });
    });
  }


  const statusDot = document.getElementById("status-dot");
  const statusText = document.getElementById("status-text");
  const errorBox = document.getElementById("error-box");

  const diagToggle = document.getElementById("diag-toggle");
  const diagContent = document.getElementById("diag-content");
  const diagExtId = document.getElementById("diag-ext-id");
  const diagRedirectUri = document.getElementById("diag-redirect-uri");
  const diagClientId = document.getElementById("diag-client-id");

  diagToggle.addEventListener("click", () => {
    const isHidden = diagContent.style.display === "none";
    diagContent.style.display = isHidden ? "block" : "none";
  });

  function showError(msg) {
    if (msg) {
      errorBox.innerText = msg;
      errorBox.style.display = "block";
    } else {
      errorBox.innerText = "";
      errorBox.style.display = "none";
    }
  }

  async function loadDiagnostics() {
    try {
      const extId = chrome.runtime.id;
      const redirectUri = (chrome.identity && chrome.identity.getRedirectURL) 
        ? chrome.identity.getRedirectURL() 
        : `https://${extId}.chromiumapp.org/`;
      const manifest = chrome.runtime.getManifest();
      const clientId = manifest.oauth2?.client_id;

      diagExtId.innerText = extId || "Unknown";
      diagRedirectUri.innerText = redirectUri || "Unknown";
      diagClientId.innerText = clientId || "Not configured";
    } catch (e) {
      console.error("Error loading diagnostics:", e);
    }
  }


  async function checkAuth() {
    showError(null);
    chrome.runtime.sendMessage({ type: "CHECK_AUTH" }, (res) => {
      if (res && res.authenticated) {
        statusDot.classList.add("active");
        statusText.innerText = "Connected to Google Contacts";
        authBtn.style.display = "none";
        authWebBtn.style.display = "none";
        signoutBtn.style.display = "block";
      } else {
        statusDot.classList.remove("active");
        statusText.innerText = "Not Connected";
        authBtn.style.display = "block";
        authWebBtn.style.display = "block";
        signoutBtn.style.display = "none";
      }
    });
  }

  function handleLogin(msgType, btnElem, defaultText) {
    showError(null);
    btnElem.disabled = true;
    btnElem.innerText = "Signing in...";

    chrome.runtime.sendMessage({ type: msgType }, (res) => {
      btnElem.disabled = false;
      btnElem.innerText = defaultText;
      
      if (res && res.success) {
        checkAuth();
      } else {
        const errorMsg = (res && res.error) ? res.error : "Sign in request failed without an error message.";
        showError(`Sign In Error (${msgType}): ${errorMsg}\n\nTip: If Chrome Native does not pop up a window, click "Sign In via Google Web Window".`);
      }
    });
  }

  authBtn.addEventListener("click", () => {
    handleLogin("LOGIN_NATIVE", authBtn, "Sign In with Google (Chrome Native)");
  });

  authWebBtn.addEventListener("click", () => {
    handleLogin("LOGIN_WEB", authWebBtn, "Sign In via Google Web Window");
  });

  signoutBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "LOGOUT" }, (res) => {
      checkAuth();
    });
  });

  loadDiagnostics();
  checkAuth();
});


