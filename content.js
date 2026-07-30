/**
 * LinkedIn Contact Reconciler - Content Script
 * Scrapes LinkedIn profile info, injects floating UI, and syncs notes & links with Google Contacts.
 */

(function () {
  let currentHandle = null;
  let currentProfileData = null;
  let linkedContact = null;
  let widgetRoot = null;
  let panelIsOpen = false;
  let searchTimeout = null;

  /**
   * Helper to parse LinkedIn handle from current URL
   */
  function getLinkedInHandleFromUrl() {
    const match = window.location.pathname.match(/\/in\/([^\/\?#]+)/i);
    return match ? match[1] : null;
  }

  /**
   * Scrape basic details from the LinkedIn profile page DOM
   */
  function scrapeProfileDetails() {
    const handle = getLinkedInHandleFromUrl();
    if (!handle) return null;

    let name = "";
    const nameSelectors = [
      ".text-heading-xlarge",
      "h1",
      ".pv-top-card--list li",
      ".ph5 h1"
    ];

    for (const sel of nameSelectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText && el.innerText.trim().length > 0) {
        name = el.innerText.trim();
        break;
      }
    }

    if (!name || name.toLowerCase() === handle.toLowerCase()) {
      const title = document.title || "";
      if (title.includes("|")) {
        name = title.split("|")[0].trim();
      } else if (title.includes("-")) {
        name = title.split("-")[0].trim();
      }
    }

    name = name.split("\n")[0].trim();
    if (!name) name = handle;

    // Job Title / Headline
    const headlineElem = document.querySelector(".text-body-medium");
    const jobTitle = headlineElem ? headlineElem.innerText.trim().split("\n")[0] : "";

    // Profile Image
    const imgElem = document.querySelector(".pv-top-card-profile-picture__image") || document.querySelector("img.profile-photo");
    const photoUrl = imgElem ? imgElem.src : "";

    return {
      handle,
      name,
      jobTitle,
      photoUrl
    };
  }


  /**
   * Send message to background script
   */
  function sendMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(response || { success: false, error: "No response from background" });
        }
      });
    });
  }

  /**
   * Initialize Widget on Profile Page
   */
  async function initWidget() {
    const handle = getLinkedInHandleFromUrl();
    console.log("[LinkedIn Reconciler] Initializing for handle:", handle);

    if (!handle) {
      removeWidget();
      return;
    }

    if (currentHandle === handle && widgetRoot) {
      injectInlineButton();
      return; // Already initialized for this handle
    }

    currentHandle = handle;
    currentProfileData = scrapeProfileDetails();

    // Check if widget DOM exists, otherwise build it
    if (!widgetRoot) {
      buildWidgetContainer();
    }

    injectInlineButton();
    renderLoadingState();

    // Check Auth Status
    const authRes = await sendMessage({ type: "CHECK_AUTH" });
    if (!authRes.authenticated) {
      console.log("[LinkedIn Reconciler] User not authenticated.");
      renderUnauthenticatedState();
      return;
    }

    // Find if contact is already linked
    console.log("[LinkedIn Reconciler] Searching for linked contact for handle:", handle);
    const findRes = await sendMessage({ type: "FIND_LINKED_CONTACT", handle });
    if (findRes.success && findRes.contact) {
      console.log("[LinkedIn Reconciler] Found linked contact:", findRes.contact.displayName);
      linkedContact = findRes.contact;
      renderLinkedState(linkedContact);
    } else {
      console.log("[LinkedIn Reconciler] No direct handle link found. Searching suggested contacts by name:", currentProfileData.name);
      linkedContact = null;
      // Try searching Google Contacts by profile name automatically
      const searchRes = await sendMessage({ type: "SEARCH_CONTACTS", query: currentProfileData.name });
      const suggestedResults = searchRes.success ? searchRes.results : [];
      renderUnlinkedState(suggestedResults);
    }
  }

  function removeWidget() {
    if (widgetRoot) {
      widgetRoot.remove();
      widgetRoot = null;
      currentHandle = null;
    }
    const inlineBtn = document.getElementById("lcr-inline-btn");
    if (inlineBtn) inlineBtn.remove();
  }

  /**
   * Build floating widget container in body
   */
  function buildWidgetContainer() {
    if (!document.body) {
      setTimeout(buildWidgetContainer, 100);
      return;
    }
    if (document.getElementById("lcr-widget-root")) {
      widgetRoot = document.getElementById("lcr-widget-root");
      return;
    }
    widgetRoot = document.createElement("div");
    widgetRoot.id = "lcr-widget-root";
    widgetRoot.style.cssText = "position: fixed !important; top: 90px !important; right: 24px !important; z-index: 2147483647 !important; pointer-events: auto !important; display: block !important;";
    document.body.appendChild(widgetRoot);
  }


  /**
   * Inject inline button directly into LinkedIn profile card header
   */
  function injectInlineButton() {
    const ctasContainer = document.querySelector(".pv-top-card-v2-ctas") || 
                          document.querySelector(".pvs-profile-actions") || 
                          document.querySelector(".ph5.pb5") || 
                          document.querySelector("main section");

    if (ctasContainer && !document.getElementById("lcr-inline-btn")) {
      const inlineBtn = document.createElement("button");
      inlineBtn.id = "lcr-inline-btn";
      inlineBtn.className = "artdeco-button artdeco-button--2 artdeco-button--primary";
      inlineBtn.style.margin = "8px 0";
      inlineBtn.style.background = "#0a66c2";
      inlineBtn.style.color = "#ffffff";
      inlineBtn.style.fontWeight = "bold";
      inlineBtn.style.borderRadius = "20px";
      inlineBtn.style.padding = "6px 16px";
      inlineBtn.innerHTML = `<span>📇 Reconcile Contact</span>`;
      inlineBtn.onclick = () => {
        panelIsOpen = true;
        const panel = document.getElementById("lcr-panel");
        if (panel) panel.classList.remove("hidden");
      };
      ctasContainer.prepend(inlineBtn);
    }
  }


  /**
   * Render Unauthenticated State
   */
  function renderUnauthenticatedState() {
    widgetRoot.innerHTML = `
      <button class="lcr-toggle-btn" id="lcr-toggle-btn">
        <span>📇 Reconcile Contact</span>
      </button>
      <div class="lcr-panel ${panelIsOpen ? '' : 'hidden'}" id="lcr-panel">
        <div class="lcr-header">
          <div class="lcr-header-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="20" y1="8" x2="20" y2="14"></line><line x1="23" y1="11" x2="17" y2="11"></line></svg>
            Google Contacts Reconciler
          </div>
          <button class="lcr-close-btn" id="lcr-close-btn">&times;</button>
        </div>
        <div class="lcr-body">
          <p style="color:var(--lcr-text-muted);">Please connect your Google Account to reconcile LinkedIn contacts with Google & iPhone contacts.</p>
          <button class="lcr-btn lcr-btn-primary" id="lcr-login-btn">
            Sign In with Google
          </button>
        </div>
      </div>
    `;

    attachCommonEventListeners();

    document.getElementById("lcr-login-btn")?.addEventListener("click", async () => {
      const loginRes = await sendMessage({ type: "LOGIN" });
      if (loginRes.success) {
        initWidget();
      } else {
        alert(`Login failed: ${loginRes.error}`);
      }
    });
  }

  /**
   * Render Loading State
   */
  function renderLoadingState() {
    widgetRoot.innerHTML = `
      <button class="lcr-toggle-btn" id="lcr-toggle-btn">
        <span>📇 Reconciling...</span>
      </button>
    `;
    attachCommonEventListeners();
  }

  /**
   * Render Linked State (Contact exists & linked)
   */
  function renderLinkedState(contact) {
    widgetRoot.innerHTML = `
      <button class="lcr-toggle-btn" id="lcr-toggle-btn" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%);">
        <span>✓ Linked: ${escapeHtml(contact.displayName)}</span>
      </button>
      <div class="lcr-panel ${panelIsOpen ? '' : 'hidden'}" id="lcr-panel">
        <div class="lcr-header">
          <div class="lcr-header-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
            Contact Reconciled
          </div>
          <button class="lcr-close-btn" id="lcr-close-btn">&times;</button>
        </div>
        <div class="lcr-body">
          <div class="lcr-status-card linked">
            ${contact.photoUrl ? `<img class="lcr-avatar" src="${escapeHtml(contact.photoUrl)}" />` : '<div class="lcr-avatar" style="background:#10b981; display:flex; align-items:center; justify-content:center; color:#fff; font-weight:bold;">' + escapeHtml(contact.displayName[0] || 'C') + '</div>'}
            <div class="lcr-contact-meta">
              <div class="lcr-contact-name">${escapeHtml(contact.displayName)}</div>
              <div class="lcr-contact-sub">${contact.emails.length ? escapeHtml(contact.emails[0].value) : 'Synced with iPhone'}</div>
            </div>
            <button class="lcr-btn-danger" id="lcr-unlink-btn" title="Unlink LinkedIn handle from Google Contact">Unlink</button>
          </div>

          <div class="lcr-section-title">Relationship Notes (Syncs to iPhone)</div>
          
          <div class="lcr-field-group">
            <textarea class="lcr-textarea" id="lcr-notes-single" rows="9" style="min-height: 160px; font-size: 13px; line-height: 1.5;" placeholder="Add relationship notes, how you met, mutual context, talking points...">${escapeHtml(contact.fullBio)}</textarea>
          </div>
        </div>
        <div class="lcr-footer">
          <div class="lcr-sync-badge" id="lcr-sync-status">
            <span>● Synced with iPhone</span>
          </div>
          <button class="lcr-btn lcr-btn-primary" id="lcr-save-notes-btn">
            <span>Save to Google & iPhone</span>
          </button>
        </div>
      </div>
    `;

    attachCommonEventListeners();
    attachLinkedStateEventListeners(contact);
  }

  /**
   * Render Unlinked State (Allows search or creation of Google Contact)
   */
  function renderUnlinkedState(suggestedResults = []) {
    const profile = currentProfileData || { name: "", jobTitle: "" };

    widgetRoot.innerHTML = `
      <button class="lcr-toggle-btn" id="lcr-toggle-btn">
        <span>🔗 Link to Google Contact</span>
      </button>
      <div class="lcr-panel ${panelIsOpen ? '' : 'hidden'}" id="lcr-panel">
        <div class="lcr-header">
          <div class="lcr-header-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
            Link LinkedIn Profile
          </div>
          <button class="lcr-close-btn" id="lcr-close-btn">&times;</button>
        </div>
        <div class="lcr-body">
          <div class="lcr-status-card unlinked">
            <div class="lcr-contact-meta">
              <div class="lcr-contact-name">${escapeHtml(profile.name)}</div>
              <div class="lcr-contact-sub">${escapeHtml(profile.jobTitle || 'LinkedIn Profile')}</div>
            </div>
          </div>

          <div class="lcr-section-title">Match with Existing Google Contact</div>
          <div class="lcr-search-box">
            <input type="text" class="lcr-input" id="lcr-contact-search" placeholder="Search Google Contacts by name or email..." value="${escapeHtml(profile.name)}" />
            <div class="lcr-search-results" id="lcr-search-results">
              ${renderSearchResultsHtml(suggestedResults)}
            </div>
          </div>

          <div style="text-align:center; color:var(--lcr-text-muted); font-size:12px; margin: 4px 0;">— OR —</div>

          <button class="lcr-btn lcr-btn-secondary" id="lcr-create-new-btn" style="width:100%;">
            ➕ Create New Contact in Google & iPhone
          </button>
        </div>
      </div>
    `;

    attachCommonEventListeners();
    attachUnlinkedStateEventListeners();
  }

  function renderSearchResultsHtml(results) {
    if (!results || results.length === 0) {
      return `<div style="padding:10px; color:var(--lcr-text-muted); font-size:12px;">No matching Google contacts found. Try typing a name above or create a new contact.</div>`;
    }
    return results.map(c => `
      <div class="lcr-search-item" data-resource-name="${escapeHtml(c.resourceName)}" data-etag="${escapeHtml(c.etag)}">
        <div>
          <div style="font-weight:600;">${escapeHtml(c.displayName)}</div>
          <div style="font-size:11px; color:var(--lcr-text-muted);">${c.emails.length ? escapeHtml(c.emails[0].value) : (c.phones.length ? escapeHtml(c.phones[0].value) : 'Google Contact')}</div>
        </div>
        <button class="lcr-btn lcr-btn-primary" style="padding:4px 8px; font-size:11px;">Link</button>
      </div>
    `).join("");
  }

  /**
   * Event Listeners
   */
  function attachCommonEventListeners() {
    const toggleBtn = document.getElementById("lcr-toggle-btn");
    const closeBtn = document.getElementById("lcr-close-btn");
    const panel = document.getElementById("lcr-panel");

    if (toggleBtn && panel) {
      toggleBtn.onclick = () => {
        panelIsOpen = !panelIsOpen;
        panel.classList.toggle("hidden", !panelIsOpen);
      };
    }

    if (closeBtn && panel) {
      closeBtn.onclick = () => {
        panelIsOpen = false;
        panel.classList.add("hidden");
      };
    }
  }

  function attachLinkedStateEventListeners(contact) {
    const saveBtn = document.getElementById("lcr-save-notes-btn");
    const unlinkBtn = document.getElementById("lcr-unlink-btn");

    if (saveBtn) {
      saveBtn.onclick = async () => {
        saveBtn.disabled = true;
        saveBtn.innerHTML = `<div class="lcr-spinner"></div> Saving...`;

        const notesText = document.getElementById("lcr-notes-single")?.value || "";

        const res = await sendMessage({
          type: "SAVE_CONTACT_NOTES",
          resourceName: contact.resourceName,
          etag: contact.etag,
          handle: currentHandle,
          notesText
        });

        if (res.success) {
          linkedContact = res.contact;
          const syncBadge = document.getElementById("lcr-sync-status");
          if (syncBadge) {
            syncBadge.innerHTML = `<span style="color:#10b981;">✓ Synced to iPhone at ${new Date().toLocaleTimeString()}</span>`;
          }
          saveBtn.innerHTML = `<span>Saved!</span>`;
          setTimeout(() => {
            saveBtn.disabled = false;
            saveBtn.innerHTML = `<span>Save to Google & iPhone</span>`;
          }, 1500);
        } else {
          alert(`Failed to save notes: ${res.error}`);
          saveBtn.disabled = false;
          saveBtn.innerHTML = `<span>Save to Google & iPhone</span>`;
        }
      };
    }

    if (unlinkBtn) {
      unlinkBtn.onclick = async () => {
        if (!confirm(`Unlink LinkedIn profile from Google contact "${contact.displayName}"?`)) return;
        const res = await sendMessage({ type: "UNLINK_CONTACT", resourceName: contact.resourceName });
        if (res.success) {
          linkedContact = null;
          initWidget();
        } else {
          alert(`Failed to unlink: ${res.error}`);
        }
      };
    }
  }

  function attachUnlinkedStateEventListeners() {
    const searchInput = document.getElementById("lcr-contact-search");
    const resultsContainer = document.getElementById("lcr-search-results");
    const createNewBtn = document.getElementById("lcr-create-new-btn");

    if (searchInput && resultsContainer) {
      searchInput.oninput = () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(async () => {
          const query = searchInput.value.trim();
          if (query.length < 2) return;
          resultsContainer.innerHTML = `<div style="padding:10px; color:var(--lcr-text-muted);">Searching Google Contacts...</div>`;
          const res = await sendMessage({ type: "SEARCH_CONTACTS", query });
          resultsContainer.innerHTML = renderSearchResultsHtml(res.success ? res.results : []);
          bindSearchItemClicks();
        }, 300);
      };
      bindSearchItemClicks();
    }

    if (createNewBtn) {
      createNewBtn.onclick = async () => {
        createNewBtn.disabled = true;
        createNewBtn.innerHTML = `<div class="lcr-spinner"></div> Creating Google Contact...`;

        const res = await sendMessage({
          type: "CREATE_AND_LINK_CONTACT",
          name: currentProfileData.name,
          handle: currentHandle,
          jobTitle: currentProfileData.jobTitle,
          notesText: ""
        });

        if (res.success) {
          linkedContact = res.contact;
          renderLinkedState(linkedContact);
        } else {
          alert(`Failed to create contact: ${res.error}`);
          createNewBtn.disabled = false;
          createNewBtn.innerHTML = `➕ Create New Contact in Google & iPhone`;
        }
      };
    }
  }

  function bindSearchItemClicks() {
    const items = document.querySelectorAll(".lcr-search-item");
    items.forEach(item => {
      item.onclick = async () => {
        const resourceName = item.getAttribute("data-resource-name");
        item.style.opacity = "0.5";
        
        const res = await sendMessage({
          type: "LINK_EXISTING_CONTACT",
          resourceName,
          handle: currentHandle
        });

        if (res.success) {
          linkedContact = res.contact;
          renderLinkedState(linkedContact);
        } else {
          alert(`Failed to link contact: ${res.error}`);
          item.style.opacity = "1";
        }
      };
    });
  }


  function escapeHtml(str = "") {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Handle SPA transitions in LinkedIn (URL changes without reload)
  let lastUrl = location.href;
  new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      if (location.pathname.includes("/in/")) {
        initWidget();
      } else {
        removeWidget();
      }
    }
  }).observe(document, { subtree: true, childList: true });

  // Message listener for popup manual trigger
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "OPEN_RECONCILER") {
      panelIsOpen = true;
      initWidget();
      const panel = document.getElementById("lcr-panel");
      if (panel) panel.classList.remove("hidden");
      sendResponse({ success: true });
    }
    return true;
  });

  // Initial load
  if (document.readyState === "complete" || document.readyState === "interactive") {
    initWidget();
  } else {
    window.addEventListener("DOMContentLoaded", initWidget);
  }
})();

