/* Render the chat's Markdown subset without interpreting model output as HTML. */
function renderChatMarkdown(text, target) {
  function element(tag, content, parent = target) {
    const node = document.createElement(tag);
    if (content !== undefined) node.textContent = content;
    parent.append(node);
    return node;
  }

  function inline(parent, value) {
    const token = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|__([^_\n]+)__|\*([^*\n]+)\*|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;
    let offset = 0;
    for (const match of value.matchAll(token)) {
      parent.append(value.slice(offset, match.index));
      if (match[1]) element('code', match[1], parent);
      else if (match[2] || match[3]) element('strong', match[2] || match[3], parent);
      else if (match[4]) element('em', match[4], parent);
      else {
        const link = element('a', match[5], parent);
        link.href = match[6];
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
      offset = match.index + match[0].length;
    }
    parent.append(value.slice(offset));
  }

  let code = null, list = null, paragraph = null;
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^ {0,3}```/.test(line)) {
      code = code ? null : element('code', '', element('pre'));
      list = paragraph = null;
      continue;
    }
    if (code) {
      code.append(line + '\n');
      continue;
    }
    const item = line.match(/^ {0,3}(?:([-+*])|(\d+)\.)\s+(.+)$/);
    if (item) {
      const tag = item[2] ? 'OL' : 'UL';
      if (list?.tagName !== tag) {
        list = element(tag);
        if (item[2]) list.start = Number(item[2]);
      }
      inline(element('li', undefined, list), item[3]);
      paragraph = null;
      continue;
    }
    list = null;
    if (!line.trim()) {
      paragraph = null;
      continue;
    }
    const heading = line.match(/^ {0,3}(#{1,6})\s+(.+)$/);
    const quote = line.match(/^ {0,3}>\s?(.*)$/);
    if (heading || quote) {
      inline(element(heading ? 'h' + Math.min(6, heading[1].length + 2) : 'blockquote'), (heading || quote).at(-1));
      paragraph = null;
    } else {
      if (!paragraph) paragraph = element('p');
      else element('br', undefined, paragraph);
      inline(paragraph, line);
    }
  }
}
