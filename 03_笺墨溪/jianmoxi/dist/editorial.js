/* Small interaction refinements. No editor remounts or text-selection interception. */
(() => {
  document.documentElement.classList.add('editorial');
  // Feature modules load their styles asynchronously; keep the shared system last.
  const sheet = document.querySelector('#editorial-style');
  if (sheet) document.head.append(sheet);

  const originalRows = articleRows;
  articleRows = function (list) {
    const template = document.createElement('template');
    template.innerHTML = originalRows(list);
    template.content.querySelectorAll('.article-row > [data-delete]').forEach(button => {
      button.dataset.articleMenu = button.dataset.delete;
      delete button.dataset.delete;
      button.setAttribute('aria-haspopup', 'dialog');
      button.title = '管理文章';
    });
    return template.innerHTML;
  };

  // Preserve existing IDs and delegated actions inside a common dialog shell.
  modal = function (html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    const heading = [...template.content.children].find(node => node.tagName === 'H2');
    const eyebrow = [...template.content.children].find(node => node.classList.contains('eyebrow'));
    const title = heading?.textContent || (template.content.querySelector('.modal-quote') ? '灵感摘记' : '查看详情');
    const label = eyebrow?.textContent;
    heading?.remove();
    eyebrow?.remove();
    const body = document.querySelector('#dialog-body');
    body.innerHTML = `<div class="modal"><header class="panel-heading"><div>${label && label !== title ? `<span class="eyebrow">${esc(label)}</span>` : ''}<h2 id="panel-title">${esc(title)}</h2></div><button class="modal-close" type="button" data-action="close" aria-label="关闭面板">×</button></header><div class="panel-content">${template.innerHTML}</div></div>`;
    const dialog = document.querySelector('#dialog');
    dialog.setAttribute('aria-labelledby', 'panel-title');
    if (!dialog.open) dialog.showModal();
  };

  function articleMenu(id) {
    const article = articles.find(item => item.id === id);
    if (!article) return toast('这篇文章已不在当前列表中');
    modal(`<span class="eyebrow">管理文章</span><h2>${esc(article.title || '未命名文章')}</h2><div class="article-menu"><button type="button" data-editorial-edit="${esc(id)}">${icon('pen')}继续编辑</button><button type="button" data-editorial-discuss="${esc(id)}">${icon('chat')}和 AI 讨论这篇文章</button><button type="button" data-editorial-export="${esc(id)}">${icon('book')}导出文字副本</button>${article.summary ? `<button type="button" data-editorial-summary="${esc(id)}">${icon('leaf')}查看文章归纳</button>` : ''}<button class="danger" type="button" data-delete="${esc(id)}">移入回收站</button></div>`);
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-editorial-chat')) {
      event.preventDefault();
      return openAssistant();
    }
    if (button.hasAttribute('data-article-menu')) return articleMenu(button.dataset.articleMenu);
    const edit = button.dataset.editorialEdit;
    if (edit) {
      if (!articles.some(article => article.id === edit)) return toast('这篇文章已不在当前列表中');
      currentId = edit;
      persist('currentId', edit);
      closeModal();
      return navigate('editor', true);
    }
    const discuss = button.dataset.editorialDiscuss;
    if (discuss) {
      const article = articles.find(item => item.id === discuss);
      if (article) return openAssistant({label:'文章 · ' + (article.title || '未命名文章'), articleId:discuss});
    }
    const exporting = button.dataset.editorialExport;
    if (exporting) {
      const article = articles.find(item => item.id === exporting);
      if (article) {
        download((article.title || '未命名文章') + '.txt', (article.title || '') + '\n\n' + article.content);
        toast('已导出文章副本');
      }
      return;
    }
    const summary = button.dataset.editorialSummary;
    if (summary) {
      const article = articles.find(item => item.id === summary);
      if (article?.summary) modal(`<span class="eyebrow">文章归纳</span><h2>${esc(article.title || '未命名文章')}</h2><p>${esc(article.summary)}</p>`);
    }
  });

  // Settings and article menus close before the existing Escape handler acts.
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
    document.querySelectorAll('.reader-directory[open]').forEach(panel => {
      panel.open = false;
      panel.querySelector('summary')?.focus({preventScroll:true});
    });
  });

  // Initial route only: later renders call the overridden view functions normally.
  // Do not rerender a focused editor just to apply presentation changes.
  if (page === 'articles') render();
})();
