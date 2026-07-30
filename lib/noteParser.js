/**
 * NoteParser utility for structuring contact notes stored in Google Contacts biographies field.
 * This preserves standard text notes while keeping a clean structured section for LinkedIn relationship context.
 */

const SECTION_HEADER = "--- LinkedIn Relationship Notes ---";
const SECTION_FOOTER = "-----------------------------------";

class NoteParser {
  /**
   * Parse full biography string into structured object and legacy bio.
   * @param {string} fullBio 
   * @returns {{ context: string, talkingPoints: string, mutualConnections: string, generalNotes: string, rawBio: string }}
   */
  static parse(fullBio = "") {
    const result = {
      context: "",
      talkingPoints: "",
      mutualConnections: "",
      generalNotes: "",
      rawBio: fullBio
    };

    if (!fullBio) return result;

    const headerIndex = fullBio.indexOf(SECTION_HEADER);
    if (headerIndex === -1) {
      // No formatted section yet, treat entire bio as generalNotes
      result.generalNotes = fullBio.trim();
      return result;
    }

    const footerIndex = fullBio.indexOf(SECTION_FOOTER, headerIndex);
    const linkedInBlock = footerIndex !== -1 
      ? fullBio.substring(headerIndex + SECTION_HEADER.length, footerIndex) 
      : fullBio.substring(headerIndex + SECTION_HEADER.length);

    const lines = linkedInBlock.split("\n");
    let currentKey = null;

    for (let line of lines) {
      line = line.trim();
      if (!line) continue;

      if (line.startsWith("• How Met / Context:")) {
        currentKey = "context";
        result.context = line.replace("• How Met / Context:", "").trim();
      } else if (line.startsWith("• Talking Points:")) {
        currentKey = "talkingPoints";
        result.talkingPoints = line.replace("• Talking Points:", "").trim();
      } else if (line.startsWith("• Mutual Connections:")) {
        currentKey = "mutualConnections";
        result.mutualConnections = line.replace("• Mutual Connections:", "").trim();
      } else if (line.startsWith("• Notes:")) {
        currentKey = "generalNotes";
        result.generalNotes = line.replace("• Notes:", "").trim();
      } else if (currentKey && result[currentKey] !== undefined) {
        result[currentKey] += "\n" + line;
      }
    }

    return result;
  }

  /**
   * Serializes note object back into full biography string, preserving non-LinkedIn notes.
   * @param {string} originalBio 
   * @param {{ context?: string, talkingPoints?: string, mutualConnections?: string, generalNotes?: string }} notes 
   * @returns {string}
   */
  static serialize(originalBio = "", notes = {}) {
    // Extract non-LinkedIn bio if any existed before
    let cleanOriginal = originalBio || "";
    const headerIndex = cleanOriginal.indexOf(SECTION_HEADER);
    if (headerIndex !== -1) {
      const footerIndex = cleanOriginal.indexOf(SECTION_FOOTER, headerIndex);
      if (footerIndex !== -1) {
        cleanOriginal = cleanOriginal.substring(0, headerIndex) + cleanOriginal.substring(footerIndex + SECTION_FOOTER.length);
      } else {
        cleanOriginal = cleanOriginal.substring(0, headerIndex);
      }
    }
    cleanOriginal = cleanOriginal.trim();

    const blocks = [];
    if (notes.context && notes.context.trim()) {
      blocks.push(`• How Met / Context: ${notes.context.trim()}`);
    }
    if (notes.talkingPoints && notes.talkingPoints.trim()) {
      blocks.push(`• Talking Points: ${notes.talkingPoints.trim()}`);
    }
    if (notes.mutualConnections && notes.mutualConnections.trim()) {
      blocks.push(`• Mutual Connections: ${notes.mutualConnections.trim()}`);
    }
    if (notes.generalNotes && notes.generalNotes.trim()) {
      blocks.push(`• Notes: ${notes.generalNotes.trim()}`);
    }

    if (blocks.length === 0) {
      return cleanOriginal;
    }

    const linkedInBlock = [
      SECTION_HEADER,
      ...blocks,
      SECTION_FOOTER
    ].join("\n");

    if (cleanOriginal) {
      return `${cleanOriginal}\n\n${linkedInBlock}`;
    }
    return linkedInBlock;
  }
}

if (typeof globalThis !== "undefined") {
  globalThis.NoteParser = NoteParser;
}
if (typeof window !== "undefined") {
  window.NoteParser = NoteParser;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = NoteParser;
}


