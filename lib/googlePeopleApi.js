/**
 * Google People API Client Helper
 * Interacts with https://people.googleapis.com/v1/ to search, retrieve, link, and update Google Contacts.
 */

const PEOPLE_BASE_URL = "https://people.googleapis.com/v1";

class GooglePeopleApi {
  /**
   * Helper to perform authenticated fetch requests
   */
  static async request(endpoint, token, options = {}) {
    const url = endpoint.startsWith("http") ? endpoint : `${PEOPLE_BASE_URL}/${endpoint.replace(/^\//, '')}`;
    const headers = {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers
    };

    const response = await fetch(url, { ...options, headers });
    
    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `Google API Error (${response.status}): ${response.statusText}`;
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error && errorJson.error.message) {
          errorMessage = errorJson.error.message;
        }
      } catch (e) {
        // use raw text
      }
      throw new Error(errorMessage);
    }

    return await response.json();
  }

  /**
   * Search Google Contacts by name, email, or query string
   * @param {string} token 
   * @param {string} query 
   */
  static async searchContacts(token, query) {
    if (!query || query.trim().length < 2) return [];

    const readMask = "names,emailAddresses,phoneNumbers,urls,biographies,photos";
    const endpoint = `people:searchContacts?query=${encodeURIComponent(query)}&readMask=${readMask}&pageSize=15`;
    
    try {
      const data = await this.request(endpoint, token);
      const results = data.results || [];
      return results.map(item => this.formatPerson(item.person));
    } catch (err) {
      console.warn("searchContacts fallback to listing connections...", err);
      // Fallback search in user connections if searchContacts is indexing
      return await this.searchConnectionsFallback(token, query);
    }
  }

  /**
   * List connections search fallback
   */
  static async searchConnectionsFallback(token, query) {
    const personFields = "names,emailAddresses,phoneNumbers,urls,biographies,photos";
    const endpoint = `people/me/connections?pageSize=100&personFields=${personFields}`;
    const data = await this.request(endpoint, token);
    const connections = data.connections || [];
    
    const qLower = query.toLowerCase();
    return connections
      .filter(p => {
        const name = (p.names && p.names[0] && p.names[0].displayName) || "";
        const emails = (p.emailAddresses || []).map(e => e.value).join(" ");
        return name.toLowerCase().includes(qLower) || emails.toLowerCase().includes(qLower);
      })
      .slice(0, 15)
      .map(p => this.formatPerson(p));
  }

  /**
   * Get specific contact by resourceName (e.g. people/c123456789)
   */
  static async getContact(token, resourceName) {
    const personFields = "names,emailAddresses,phoneNumbers,urls,biographies,photos";
    const endpoint = `${resourceName}?personFields=${personFields}`;
    const person = await this.request(endpoint, token);
    return this.formatPerson(person);
  }

  /**
   * Find a Google Contact linked with a specific LinkedIn handle or URL
   * @param {string} token 
   * @param {string} handle 
   */
  static async findContactByLinkedInHandle(token, handle) {
    if (!handle) return null;
    const cleanHandle = handle.toLowerCase().replace(/\/+$/, "").replace(/[^a-z0-9-]/g, "");

    // 1. Try searchContacts API endpoint first
    try {
      const readMask = "names,emailAddresses,phoneNumbers,urls,biographies,photos";
      const searchEndpoint = `people:searchContacts?query=${encodeURIComponent(cleanHandle)}&readMask=${readMask}&pageSize=10`;
      const searchData = await this.request(searchEndpoint, token);
      const results = searchData.results || [];
      for (const item of results) {
        const formatted = this.formatPerson(item.person);
        if (formatted.linkedInHandle && formatted.linkedInHandle.toLowerCase() === cleanHandle) {
          return formatted;
        }
        const urls = item.person.urls || [];
        for (const u of urls) {
          if (u.value && u.value.toLowerCase().includes(cleanHandle)) {
            return formatted;
          }
        }
      }
    } catch (e) {
      console.warn("searchContacts API search error, falling back to connection scanning:", e);
    }

    // 2. Fallback: Scan user connections
    const personFields = "names,emailAddresses,phoneNumbers,urls,biographies,photos";
    const endpoint = `people/me/connections?pageSize=500&personFields=${personFields}`;
    
    const data = await this.request(endpoint, token);
    const connections = data.connections || [];

    for (const person of connections) {
      const formatted = this.formatPerson(person);
      if (formatted.linkedInHandle && formatted.linkedInHandle.toLowerCase() === cleanHandle) {
        return formatted;
      }
      
      const urls = person.urls || [];
      for (const u of urls) {
        if (u.value && u.value.toLowerCase().includes(cleanHandle)) {
          return formatted;
        }
      }

      if (person.biographies && person.biographies[0] && person.biographies[0].value) {
        if (person.biographies[0].value.toLowerCase().includes(cleanHandle)) {
          return formatted;
        }
      }
    }

    return null;
  }

  /**
   * Create a new Google Contact for a LinkedIn profile
   * @param {string} token 
   * @param {{ name: string, handle: string, notes?: string, jobTitle?: string }} data 
   */
  static async createContact(token, data) {
    const linkedInUrl = `https://www.linkedin.com/in/${data.handle}/`;
    
    const nameParts = (data.name || "").trim().split(/\s+/);
    const givenName = nameParts[0] || data.name || data.handle;
    const familyName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";

    const payload = {
      names: [{ givenName, familyName, displayName: data.name || givenName }],
      urls: [
        { value: linkedInUrl, type: "LinkedIn", formattedType: "LinkedIn" }
      ]
    };

    if (data.jobTitle) {
      payload.organizations = [{ title: data.jobTitle }];
    }

    if (data.notes) {
      payload.biographies = [{ value: data.notes, contentType: "TEXT_PLAIN" }];
    }

    const newPerson = await this.request("people:createContact", token, {
      method: "POST",
      body: JSON.stringify(payload)
    });

    return this.formatPerson(newPerson);
  }

  /**
   * Update LinkedIn URL and Notes for an existing contact
   * @param {string} token 
   * @param {string} resourceName 
   * @param {string} etag 
   * @param {string} linkedInHandle 
   * @param {string} serializedBio 
   */
  static async updateContactLinkedInAndNotes(token, resourceName, etag, linkedInHandle, serializedBio) {
    // 1. First fetch full current person data to preserve existing URLs & bio structure
    const fullPerson = await this.request(`${resourceName}?personFields=urls,biographies`, token);
    
    const linkedInUrl = `https://www.linkedin.com/in/${linkedInHandle}/`;
    
    // Prepare updated URLs array
    let currentUrls = fullPerson.urls || [];
    let updatedUrls = [...currentUrls];
    
    const existingIndex = updatedUrls.findIndex(u => 
      (u.value && u.value.toLowerCase().includes("linkedin.com/in/")) || 
      (u.type && u.type.toLowerCase() === "linkedin") ||
      (u.formattedType && u.formattedType.toLowerCase() === "linkedin")
    );

    if (existingIndex !== -1) {
      updatedUrls[existingIndex] = { ...updatedUrls[existingIndex], value: linkedInUrl, type: "LinkedIn", formattedType: "LinkedIn" };
    } else {
      updatedUrls.push({ value: linkedInUrl, type: "LinkedIn", formattedType: "LinkedIn" });
    }

    // Prepare updated Biographies array
    const updatedBio = [{ value: serializedBio, contentType: "TEXT_PLAIN" }];

    const payload = {
      etag: fullPerson.etag || etag,
      resourceName: resourceName,
      urls: updatedUrls,
      biographies: updatedBio
    };

    const endpoint = `${resourceName}:updateContact?updatePersonFields=urls,biographies`;
    const updatedPerson = await this.request(endpoint, token, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });

    return this.formatPerson(updatedPerson);
  }





  /**
   * Unlink LinkedIn URL from a Google Contact
   */
  static async unlinkLinkedIn(token, resourceName) {
    const fullPerson = await this.request(`${resourceName}?personFields=urls`, token);
    let currentUrls = fullPerson.urls || [];
    let filteredUrls = currentUrls.filter(u => 
      !(u.value && u.value.toLowerCase().includes("linkedin.com/in/")) && 
      !(u.formattedType && u.formattedType.toLowerCase() === "linkedin")
    );

    const payload = {
      etag: fullPerson.etag,
      resourceName: resourceName,
      urls: filteredUrls
    };

    const endpoint = `${resourceName}:updateContact?updatePersonFields=urls`;
    const updatedPerson = await this.request(endpoint, token, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });

    return this.formatPerson(updatedPerson);
  }

  /**
   * Standardize person object for internal extension consumption
   */
  static formatPerson(person) {
    if (!person) return null;

    const resourceName = person.resourceName || "";
    const etag = person.etag || "";
    const names = person.names || [];
    const displayName = names[0] ? names[0].displayName : "Unnamed Contact";
    const photos = person.photos || [];
    const photoUrl = photos[0] ? photos[0].url : "";

    const emails = (person.emailAddresses || []).map(e => ({ value: e.value, type: e.type || "other" }));
    const phones = (person.phoneNumbers || []).map(p => ({ value: p.value, type: p.type || "other" }));
    const urls = person.urls || [];
    const bios = person.biographies || [];
    const fullBio = bios[0] ? bios[0].value : "";

    // Extract LinkedIn handle if present
    let linkedInUrl = "";
    let linkedInHandle = "";
    for (const u of urls) {
      if (u.value && u.value.toLowerCase().includes("linkedin.com/in/")) {
        linkedInUrl = u.value;
        const match = u.value.match(/linkedin\.com\/in\/([^\/\?#]+)/i);
        if (match && match[1]) {
          linkedInHandle = match[1];
        }
        break;
      }
    }

    return {
      resourceName,
      etag,
      displayName,
      photoUrl,
      emails,
      phones,
      linkedInUrl,
      linkedInHandle,
      fullBio
    };
  }
}

if (typeof globalThis !== "undefined") {
  globalThis.GooglePeopleApi = GooglePeopleApi;
}
if (typeof window !== "undefined") {
  window.GooglePeopleApi = GooglePeopleApi;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = GooglePeopleApi;
}


