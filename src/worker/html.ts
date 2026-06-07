export function htmlToPlainText(html: string): string {
  let output = "";
  let index = 0;

  while (index < html.length) {
    const tagStart = html.indexOf("<", index);
    if (tagStart === -1) {
      output += html.slice(index);
      break;
    }

    output += html.slice(index, tagStart);
    const tagEnd = html.indexOf(">", tagStart + 1);
    if (tagEnd === -1) {
      output += html.slice(tagStart);
      break;
    }

    const tagSource = html.slice(tagStart + 1, tagEnd);
    const tagName = readTagName(tagSource);
    const closing = startsWithClosingSlash(tagSource);

    if (!closing && (tagName === "script" || tagName === "style")) {
      index = afterClosingTag(html, tagName, tagEnd + 1);
      output += " ";
      continue;
    }

    output += tagName === "br" || (closing && tagName === "p") ? "\n" : " ";
    index = tagEnd + 1;
  }

  return output.replaceAll("&nbsp;", " ").replace(/\s+/g, " ").trim();
}

function startsWithClosingSlash(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 32 || code === 9 || code === 10 || code === 13 || code === 12) continue;
    return value[index] === "/";
  }
  return false;
}

function readTagName(value: string): string {
  let index = 0;
  while (index < value.length) {
    const code = value.charCodeAt(index);
    if (code === 32 || code === 9 || code === 10 || code === 13 || code === 12 || value[index] === "/") {
      index += 1;
      continue;
    }
    break;
  }

  const start = index;
  while (index < value.length && isTagNameCharacter(value.charCodeAt(index))) {
    index += 1;
  }

  return value.slice(start, index).toLowerCase();
}

function isTagNameCharacter(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 45 ||
    code === 58
  );
}

function afterClosingTag(html: string, tagName: string, fromIndex: number): number {
  const lowerHtml = html.toLowerCase();
  const closingTag = `</${tagName}`;
  const closeStart = lowerHtml.indexOf(closingTag, fromIndex);
  if (closeStart === -1) return html.length;

  const closeEnd = html.indexOf(">", closeStart + closingTag.length);
  return closeEnd === -1 ? html.length : closeEnd + 1;
}
