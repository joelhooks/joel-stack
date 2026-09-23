const audienceTag =
  /<(?:AgentOnly|HumanOnly|Diagram)(?:\s[^>]*)?>|<\/(?:AgentOnly|HumanOnly|Diagram)>/u;

const agentBlock =
  /<AgentOnly>\s*\r?\n(?<content>[\s\S]*?)\r?\n\s*<\/AgentOnly>/gu;

const humanBlock =
  /<HumanOnly>\s*\r?\n(?<content>[\s\S]*?)\r?\n\s*<\/HumanOnly>/gu;

const diagramBlock =
  /<Diagram\s+alt="(?<alt>[^"]*)">\s*\r?\n(?<fence>```text\r?\n[\s\S]*?\r?\n```)\s*\r?\n<\/Diagram>/gu;

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export const deriveAgentMarkdown = (source: string): string => {
  if (!audienceTag.test(source)) {
    return source;
  }

  const withoutHuman = source.replaceAll(humanBlock, "");

  const withDiagramText = withoutHuman.replaceAll(
    diagramBlock,
    (_match: string, alt: string, fence: string) => `${fence}\nDiagram: ${alt}`
  );

  return withDiagramText.replaceAll(agentBlock, "$<content>");
};

export const deriveHtmlMarkdown = (source: string): string => {
  if (!audienceTag.test(source)) {
    return source;
  }

  const withDiagrams = source.replaceAll(
    diagramBlock,
    (_match: string, alt: string, fence: string) =>
      `<figure role="img" aria-label="${escapeHtml(alt)}">\n\n${fence}\n\n<figcaption>${escapeHtml(alt)}</figcaption></figure>`
  );

  const withoutAgent = withDiagrams.replaceAll(agentBlock, "");

  return withoutAgent.replaceAll(humanBlock, "$<content>");
};

export const hasAudienceSyntax = (source: string) => audienceTag.test(source);

interface IcoImage {
  readonly bytes: Uint8Array;
  readonly size: number;
}

export const encodeIco = (images: readonly IcoImage[]): Uint8Array => {
  const headerSize = 6 + images.length * 16;

  const total = images.reduce(
    (length, image) => length + image.bytes.length,
    headerSize
  );

  const ico = new Uint8Array(total);
  const view = new DataView(ico.buffer);
  view.setUint16(2, 1, true);
  view.setUint16(4, images.length, true);
  let offset = headerSize;

  for (const [index, image] of images.entries()) {
    const entry = 6 + index * 16;
    view.setUint8(entry, image.size % 256);
    view.setUint8(entry + 1, image.size % 256);
    view.setUint16(entry + 4, 1, true);
    view.setUint16(entry + 6, 32, true);
    view.setUint32(entry + 8, image.bytes.length, true);
    view.setUint32(entry + 12, offset, true);
    ico.set(image.bytes, offset);
    offset += image.bytes.length;
  }

  return ico;
};
