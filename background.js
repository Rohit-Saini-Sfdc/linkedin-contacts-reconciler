import "./lib/googlePeopleApi.js";
import "./lib/noteParser.js";

const GooglePeopleApi = globalThis.GooglePeopleApi;
const NoteParser = globalThis.NoteParser;


/**
 * Retrieve cached token from chrome.storage.local
 */
async function getStoredToken() {
  const data = await chrome.storage.local.get(["stored_oauth_token", "is_logged_out"]);
  if (data.is_logged_out) return null;
  return data.stored_oauth_token || null;
}

/**
 * Save token to chrome.storage.local
 */
async function setStoredToken(token) {
  if (token) {
    await chrome.storage.local.set({ stored_oauth_token: token, is_logged_out: false });
  } else {
    await chrome.storage.local.remove("stored_oauth_token");
    await chrome.storage.local.set({ is_logged_out: true });
  }
}

/**
 * Method 1: Native Chrome Extension OAuth (chrome.identity.getAuthToken)
 */
async function getAuthTokenNative(interactive = true) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) {
        console.warn("getAuthToken native error:", chrome.runtime.lastError.message);
        return reject(new Error(chrome.runtime.lastError.message));
      }
      if (!token) {
        return reject(new Error("No token returned by chrome.identity.getAuthToken."));
      }
      resolve(token);
    });
  });
}

/**
 * Method 2: Web OAuth Flow (chrome.identity.launchWebAuthFlow)
 * Highly reliable for unpacked extensions & custom Google Cloud OAuth setups.
 */
async function getAuthTokenWebFlow(interactive = true) {
  const manifest = chrome.runtime.getManifest();
  const clientId = manifest.oauth2?.client_id;
  if (!clientId || clientId.includes("YOUR_GOOGLE_CLIENT_ID")) {
    throw new Error("Missing valid client_id in manifest.json");
  }

  const redirectUri = chrome.identity.getRedirectURL();
  const scopes = encodeURIComponent((manifest.oauth2?.scopes || ["https://www.googleapis.com/auth/contacts"]).join(" "));
  
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${encodeURIComponent(clientId)}` +
    `&response_type=token` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${scopes}` +
    `&prompt=select_account`;

  console.log("Launching Web Auth Flow with URL:", authUrl);

  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive }, (redirectUrl) => {
      if (chrome.runtime.lastError) {
        console.error("launchWebAuthFlow error:", chrome.runtime.lastError.message);
        return reject(new Error(chrome.runtime.lastError.message));
      }
      if (!redirectUrl) {
        return reject(new Error("Authorization flow cancelled or window closed."));
      }
      try {
        const url = new URL(redirectUrl);
        const hashParams = new URLSearchParams(url.hash.substring(1));
        const token = hashParams.get("access_token");
        if (token) {
          resolve(token);
        } else {
          const errorMsg = hashParams.get("error") || "No access_token found in response URI.";
          reject(new Error(errorMsg));
        }
      } catch (e) {
        reject(new Error(`Failed to parse auth response: ${e.message}`));
      }
    });
  });
}

/**
 * Unified OAuth Token Retriever with Fallback
 */
async function getAuthToken(interactive = true) {
  const data = await chrome.storage.local.get(["stored_oauth_token", "is_logged_out"]);
  if (data.is_logged_out && !interactive) {
    throw new Error("User manually logged out.");
  }

  const existingToken = data.stored_oauth_token;
  if (existingToken && !interactive) {
    return existingToken;
  }

  // Try Native Method first
  try {
    console.log("Attempting native chrome.identity.getAuthToken...");
    const token = await getAuthTokenNative(interactive);
    await setStoredToken(token);
    return token;
  } catch (nativeError) {
    console.warn("Native Auth failed, attempting launchWebAuthFlow fallback...", nativeError.message);
    
    // If non-interactive check failed, try stored token
    if (!interactive && existingToken) {
      return existingToken;
    }

    // Try Web Auth Flow fallback
    try {
      const token = await getAuthTokenWebFlow(interactive);
      await setStoredToken(token);
      return token;
    } catch (webFlowError) {
      console.error("Web Flow Auth also failed:", webFlowError.message);
      throw new Error(`Authentication failed. Native: "${nativeError.message}". WebFlow: "${webFlowError.message}"`);
    }
  }
}

/**
 * Invalidate & Clear token
 */
async function invalidateToken(token) {
  const currentToken = token || (await getStoredToken());
  if (currentToken) {
    chrome.identity.removeCachedAuthToken({ token: currentToken }, () => {});
  }
  await setStoredToken(null);
}


/**
 * Safely execute API function with token auto-refresh retry
 */
async function withAuth(apiFn) {
  let token;
  try {
    token = await getAuthToken(false);
  } catch (e) {
    token = await getAuthToken(true);
  }

  try {
    return await apiFn(token);
  } catch (err) {
    if (err.message && (err.message.includes("401") || err.message.includes("UNAUTHENTICATED") || err.message.includes("Invalid Credentials"))) {
      console.warn("Token expired/invalid, refreshing...", err);
      await invalidateToken(token);
      const newToken = await getAuthToken(true);
      return await apiFn(newToken);
    }
    throw err;
  }
}

// Message Listener for Content Scripts & Popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handleAsync = async () => {
    switch (message.type) {
      case "GET_DIAGNOSTICS": {
        const manifest = chrome.runtime.getManifest();
        const extensionId = chrome.runtime.id;
        const redirectUri = chrome.identity.getRedirectURL();
        const clientId = manifest.oauth2?.client_id;
        const token = await getStoredToken();
        return {
          extensionId,
          redirectUri,
          clientId,
          hasToken: !!token
        };
      }

      case "CHECK_AUTH": {
        try {
          const token = await getAuthToken(false);
          return { authenticated: true, token };
        } catch (e) {
          return { authenticated: false, error: e.message };
        }
      }

      case "LOGIN":
      case "LOGIN_NATIVE": {
        try {
          console.log("LOGIN_NATIVE requested...");
          const token = await getAuthTokenNative(true);
          await setStoredToken(token);
          return { success: true, token };
        } catch (e) {
          console.warn("LOGIN_NATIVE failed:", e.message);
          return { success: false, error: `Native Auth Error: ${e.message}` };
        }
      }

      case "LOGIN_WEB": {
        try {
          console.log("LOGIN_WEB requested...");
          const token = await getAuthTokenWebFlow(true);
          await setStoredToken(token);
          return { success: true, token };
        } catch (e) {
          console.warn("LOGIN_WEB failed:", e.message);
          return { success: false, error: `Web Auth Error: ${e.message}` };
        }
      }


      case "LOGOUT": {
        try {
          await invalidateToken();
          return { success: true };
        } catch (e) {
          return { success: false, error: e.message };
        }
      }

      case "SEARCH_CONTACTS": {
        return await withAuth(async (token) => {
          const results = await GooglePeopleApi.searchContacts(token, message.query);
          return { success: true, results };
        });
      }

      case "FIND_LINKED_CONTACT": {
        return await withAuth(async (token) => {
          const contact = await GooglePeopleApi.findContactByLinkedInHandle(token, message.handle);
          return { success: true, contact };
        });
      }

      case "LINK_EXISTING_CONTACT": {
        return await withAuth(async (token) => {
          const { resourceName, handle } = message;
          const fullPerson = await GooglePeopleApi.getContact(token, resourceName);
          const updatedPerson = await GooglePeopleApi.updateContactLinkedInAndNotes(
            token,
            resourceName,
            fullPerson.etag,
            handle,
            fullPerson.fullBio || ""
          );
          return { success: true, contact: updatedPerson };
        });
      }

      case "SAVE_CONTACT_NOTES": {
        return await withAuth(async (token) => {
          const { resourceName, etag, handle, notesText } = message;
          const updatedPerson = await GooglePeopleApi.updateContactLinkedInAndNotes(
            token,
            resourceName,
            etag,
            handle,
            notesText || ""
          );
          return { success: true, contact: updatedPerson };
        });
      }

      case "CREATE_AND_LINK_CONTACT": {
        return await withAuth(async (token) => {
          const { name, handle, jobTitle, notesText } = message;
          const newPerson = await GooglePeopleApi.createContact(token, {
            name,
            handle,
            jobTitle,
            notes: notesText || ""
          });
          return { success: true, contact: newPerson };
        });
      }

      case "UNLINK_CONTACT": {
        return await withAuth(async (token) => {
          const updatedPerson = await GooglePeopleApi.unlinkLinkedIn(token, message.resourceName);
          return { success: true, contact: updatedPerson };
        });
      }


      default:
        throw new Error(`Unknown message type: ${message.type}`);
    }
  };

  handleAsync()
    .then((res) => sendResponse(res))
    .catch((err) => {
      console.error("Background error processing message:", message.type, err);
      sendResponse({ success: false, error: err.message || String(err) });
    });

  return true; // async response indicator
});

