import { JSDOM } from "jsdom";

/**
 * The document parser needs DOMParser/NodeFilter, but we keep Node's own Blob,
 * Response and DecompressionStream (jsdom's Blob lacks .stream()). So instead of the
 * jsdom test environment, borrow just the XML pieces.
 */
export function installXmlDom() {
  const { window } = new JSDOM("");
  Object.assign(globalThis, { DOMParser: window.DOMParser, NodeFilter: window.NodeFilter });
}
