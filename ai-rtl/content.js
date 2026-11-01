(() => {
  'use strict';

  const HOST = vzxSiteHost(location.hostname);
  const GOOGLE_SEARCH = vzxIsGoogleSearch(HOST, location.pathname);
  // Google's generated answer and ordinary result column. Keep navigation,
  // account controls and the rest of Google's applications outside this scope.
  const GOOGLE_CONTENT = '[data-scope-id="turn"], #rso';
  // Letters, rather than Arabic punctuation or digits alone, identify Persian/Arabic text.
  const RTL_RE = /[\u0620-\u063F\u0641-\u064A\u066E-\u066F\u0671-\u06D3\u06D5\u06E5-\u06E6\u06EE-\u06EF\u06FA-\u06FC\u06FF\u0750-\u077F\u08A0-\u08C9\uFB50-\uFDFF\uFE70-\uFEFC]/u;
  const CLAUDE_PROSE = HOST === 'claude.ai';
  const PROTECTED = 'pre, code, kbd, samp, var, math, .katex, .MathJax, mjx-container, svg, canvas' +
    (CLAUDE_PROSE ? ', [data-not-prose]' : '');
  const SKIP = PROTECTED + ', script, style, noscript, iframe, object, embed, button, select, option, ' +
    '[role="button"], [role="switch"], [role="tab"], [aria-hidden="true"], ' +
    '.monaco-editor, .cm-editor, .CodeMirror, [contenteditable="false"], [data-vzx-ignore]';
  const INPUTS = 'textarea, input:not([type]), input[type="text"], input[type="search"], ' +
    '[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]';
  const CONTROLS = 'button, input, textarea, select, [role="button"], [role="switch"], [role="tab"]';
  const TEXT_TAGS = /^(P|H[1-6]|DIV|SPAN|LI|TD|TH|BLOCKQUOTE|FIGCAPTION|DT|DD|A|LABEL|STRONG|EM|B|I|SMALL|MARK|SUB|SUP|SUMMARY)$/;
  const STYLE_ID = 'vzx-style';
  let settings = { ...VZX_DEFAULT_SETTINGS };
  let running = false;
  let observer = null;
  let scheduled = false;
  let generation = 0;
  const pending = new Set();
  const directed = new Set();
  const fonts = new Set();
  const protectedFonts = new Set();
  const lists = new Set();
  const listItems = new Set();
  const listMetrics = new Map();
  const listLayouts = new Map();
  const layoutOwners = new Map();
  const savedProperties = new Map();

  function shouldRun() {
    return settings.enabled && !vzxMatch(HOST, settings.disabledHosts) &&
      (settings.allSites || vzxIsDefaultSite(HOST, location.pathname) || vzxMatch(HOST, settings.customHosts));
  }

  function applyStyle() {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(style);
    }
    const url = chrome.runtime.getURL('fonts/Vazirmatn-Variable.woff2');
    const choices = vzxFontChoices(settings);
    const sources = {
      vazirmatn: `url("${url}") format("woff2")`,
      tahoma: 'local("Tahoma")', arial: 'local("Arial")',
      'segoe-ui': 'local("Segoe UI")', system: 'local("Segoe UI"),local("Arial")',
      georgia: 'local("Georgia")', 'times-new-roman': 'local("Times New Roman")'
    };
    const css = `
@font-face {
  font-family:VzxFa;src:${sources[choices.persian]};
  font-weight:${choices.persian === 'vazirmatn' ? '100 900' : '400'};font-style:normal;font-display:swap;
  unicode-range:U+0600-06FF,U+0750-077F,U+08A0-08FF,U+200C-200D,U+FB50-FDFF,U+FE70-FEFF,U+00AB,U+00BB;
}
@font-face {
  font-family:VzxAll;src:${sources[choices.english] || sources.vazirmatn};
  font-weight:${choices.english === 'vazirmatn' ? '100 900' : '400'};font-style:normal;font-display:swap;
  unicode-range:U+0000-024F,U+1E00-1EFF,U+2000-206F;
}
[data-vzx-f] {font-family:${fontFamilyCss()}!important;}
:root:not([data-vzx-measure-size]) [data-vzx-size] {font-size:var(--vzx-size)!important;}
:root[data-vzx-size-transition] :is([data-vzx-f], [data-vzx-f] *) {transition-property:none!important;}
[data-vzx-protected-font] {font-family:var(--vzx-protected-font)!important;}
:root:not([data-vzx-measure-direction]) :is([data-vzx-d="rtl"], [data-vzx-item="rtl"]) {direction:rtl!important;unicode-bidi:isolate!important;}
:root:not([data-vzx-measure-direction]) :is([data-vzx-d="ltr"], [data-vzx-item="ltr"]) {direction:ltr!important;unicode-bidi:isolate!important;}
[data-vzx-align] {text-align:start!important;}
:root:not([data-vzx-measure-direction]) [data-vzx-list="rtl"] {direction:rtl!important;}
:root:not([data-vzx-measure-direction]) [data-vzx-list="ltr"] {direction:ltr!important;}
:root:not([data-vzx-measure-direction]) [data-vzx-layout-direction="rtl"] {direction:rtl!important;}
:root:not([data-vzx-measure-direction]) [data-vzx-layout-direction="ltr"] {direction:ltr!important;}
[data-vzx-list] {
  padding-inline-start:var(--vzx-list-start)!important;
  padding-inline-end:var(--vzx-list-end)!important;
}
:is([data-vzx-d], [data-vzx-item]) :is(pre, code, kbd, samp, var, math, .katex, .MathJax, mjx-container) {
  direction:ltr!important;unicode-bidi:isolate!important;
}
:is([data-vzx-d], [data-vzx-item]) pre {text-align:left!important;}
${CLAUDE_PROSE ? ':is([data-vzx-d], [data-vzx-item]) [data-not-prose] {direction:ltr!important;unicode-bidi:isolate!important;}' : ''}
`;
    // Do not recreate @font-face rules when an unrelated site's settings change.
    if (style.textContent !== css) style.textContent = css;
  }

  // Only our CSS attributes and custom properties change. Site dir/style values stay intact.
  function setAttribute(el, name, value) {
    if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  }

  function setProperty(el, name, value, priority = '') {
    if (el.style.getPropertyValue(name) === value && el.style.getPropertyPriority(name) === priority) return;
    if (!savedProperties.has(el)) savedProperties.set(el, new Map());
    const saved = savedProperties.get(el);
    if (!saved.has(name)) saved.set(name, [el.style.getPropertyValue(name), el.style.getPropertyPriority(name)]);
    el.style.setProperty(name, value, priority);
  }

  function restoreProperty(el, name) {
    const saved = savedProperties.get(el);
    if (!saved?.has(name)) return;
    const [value, priority] = saved.get(name);
    if (value) el.style.setProperty(name, value, priority);
    else el.style.removeProperty(name);
    saved.delete(name);
    if (!saved.size) savedProperties.delete(el);
  }

  function readText(root, excludeLists = false) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
        if (node.matches(SKIP) || (excludeLists && node.matches('ul, ol'))) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_SKIP;
      }
    });
    let text = '';
    let node;
    while ((node = walker.nextNode())) text += node.nodeValue;
    return text;
  }

  function isLayout(display) {
    return /flex|grid|table/.test(display);
  }

  function hasLayoutInside(el) {
    // Inheriting RTL into flex/grid/table also changes the position of their children.
    return Array.from(el.querySelectorAll(CONTROLS)).some(child =>
      !(CLAUDE_PROSE && child.closest('[data-not-prose]'))) || Array.from(el.querySelectorAll('*')).some((child) =>
      !child.closest(SKIP) && isLayout(getComputedStyle(child).display));
  }

  function isTextList(list) {
    const items = getTextListItems(list);
    return list?.matches('ul, ol') && getComputedStyle(list).display === 'block' && items.length > 0 &&
      items.every(item => item.tagName === 'LI' && getComputedStyle(item).display === 'list-item') &&
      !list.closest(SKIP);
  }

  function inGoogleOverview(el) {
    return GOOGLE_SEARCH && !!el?.closest('[data-scope-id="turn"]');
  }

  function getTextListItems(list) {
    if (!list) return [];
    return Array.from(list.children).flatMap(child => {
      // Current AI Overview uses UL > DIV[data-bfc] > LI as well as UL > LI.
      if (inGoogleOverview(list) && child.tagName === 'DIV' &&
          ['block', 'contents'].includes(getComputedStyle(child).display) &&
          child.children.length === 1 && child.firstElementChild.tagName === 'LI' &&
          !Array.from(child.childNodes).some(n => n.nodeType === Node.TEXT_NODE && n.nodeValue.trim())) {
        return [child.firstElementChild];
      }
      return [child];
    });
  }

  function isMessageProseList(list) {
    // Only actual message lists may contain independent code toolbars, display
    // math, and callouts. Navigation and other interactive lists stay excluded.
    return isTextList(list) && ((HOST === 'antigravity.google.com' && !!list.closest('article, [role="article"]')) ||
      (CLAUDE_PROSE && !!list.closest('.standard-markdown')));
  }

  function originalDirections(elements) {
    const root = document.documentElement;
    const previous = root.getAttribute('data-vzx-measure-direction');
    const suspended = [];
    const directions = new Map();
    root.setAttribute('data-vzx-measure-direction', '');
    try {
      // Include inline !important overrides in the suspension, so newly streamed
      // widgets do not accidentally inherit our already-RTL list's direction.
      for (const [el, properties] of savedProperties) if (properties.has('direction')) {
        suspended.push([el, el.style.getPropertyValue('direction'), el.style.getPropertyPriority('direction')]);
        const [value, priority] = properties.get('direction');
        if (value) el.style.setProperty('direction', value, priority);
        else el.style.removeProperty('direction');
      }
      for (const el of elements) directions.set(el, getComputedStyle(el).direction);
    } finally {
      for (const [el, value, priority] of suspended) {
        if (value) el.style.setProperty('direction', value, priority);
        else el.style.removeProperty('direction');
      }
      if (previous === null) root.removeAttribute('data-vzx-measure-direction');
      else root.setAttribute('data-vzx-measure-direction', previous);
    }
    return directions;
  }

  function releaseLayout(list, el) {
    const owners = layoutOwners.get(el);
    owners?.delete(list);
    if (owners?.size) return;
    layoutOwners.delete(el);
    el.removeAttribute('data-vzx-layout-direction');
    restoreProperty(el, 'direction');
    if (protectedFonts.has(el)) {
      el.removeAttribute('data-vzx-protected-font');
      restoreProperty(el, '--vzx-protected-font');
      protectedFonts.delete(el);
    }
  }

  function preserveListLayouts(list) {
    const layouts = new Set(Array.from(list.querySelectorAll('*')).filter(el => {
      if (el.closest(PROTECTED) || el.parentElement?.closest(SKIP)) return false;
      const display = getComputedStyle(el).display;
      // Cells still need their own Persian text direction; the table and rows
      // preserve column order independently of that text.
      return isLayout(display) && display !== 'table-cell';
    }));
    for (const el of listLayouts.get(list) || []) if (!layouts.has(el)) releaseLayout(list, el);
    const directions = layouts.size ? originalDirections(layouts) : new Map();
    for (const el of layouts) {
      if (!layoutOwners.has(el)) {
        layoutOwners.set(el, new Set());
      }
      setDirection(el, 'data-vzx-layout-direction', directions.get(el));
      layoutOwners.get(el).add(list);
    }
    listLayouts.set(list, layouts);
  }

  function findTextBlock(parent) {
    let inline = null;
    for (let el = parent; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      if (!TEXT_TAGS.test(el.tagName) || el.matches(SKIP)) return inline;
      const display = getComputedStyle(el).display;
      if (display === 'inline' || display === 'contents') {
        inline = el;
        continue;
      }
      if (isLayout(display) && display !== 'table-cell') return inline;
      const blockChild = Array.from(el.children).some((child) => {
        if (child.matches(SKIP) || child.tagName === 'BR') return false;
        return !['inline', 'inline-block', 'contents', 'none'].includes(getComputedStyle(child).display);
      });
      // Inline citations do not turn prose into an application layout. Its
      // independent controls are protected before reversing the paragraph.
      return !blockChild && (!hasLayoutInside(el) || inGoogleOverview(el)) ? el : inline;
    }
    return inline;
  }

  function setAlignment(el) {
    // Preserve deliberate centering and justified text.
    if (el.hasAttribute('data-vzx-align')) return;
    if (!['center', 'justify', 'justify-all'].includes(getComputedStyle(el).textAlign)) {
      setAttribute(el, 'data-vzx-align', '');
      if (!['start', 'right'].includes(getComputedStyle(el).textAlign) ||
          (getComputedStyle(el).direction === 'ltr' && getComputedStyle(el).textAlign === 'right')) {
        setProperty(el, 'text-align', 'start', 'important');
      }
    }
  }

  function setDirection(el, attribute, direction) {
    setAttribute(el, attribute, direction);
    if (getComputedStyle(el).direction !== direction) setProperty(el, 'direction', direction, 'important');
  }

  function clearDirection(el) {
    for (const layout of listLayouts.get(el) || []) releaseLayout(el, layout);
    listLayouts.delete(el);
    el.removeAttribute('data-vzx-d');
    if (!listItems.has(el)) {
      el.removeAttribute('data-vzx-align');
      restoreProperty(el, 'text-align');
      restoreProperty(el, 'direction');
    }
    directed.delete(el);
  }

  function updateDirection(el, input = false) {
    if (el.closest(SKIP)) return clearDirection(el);
    // Google places the heading, site name and URL in one result link. Reversing
    // a full-width site-name span shifts its text away from the icon. Keep the
    // header's native direction/alignment; font and size are applied separately.
    if (GOOGLE_SEARCH && el.closest('#rso') && !el.closest('[data-scope-id="turn"]') &&
        (el.closest('h3, .VuuXrf') || el.closest('a')?.querySelector('h3'))) return clearDirection(el);
    // A list item is handled with its list, so markers cannot overflow the content box.
    if (!input && el.tagName === 'LI') return clearDirection(el);
    if (input && !('value' in el) && (isLayout(getComputedStyle(el).display) || hasLayoutInside(el))) return clearDirection(el);
    const text = input && 'value' in el ? el.value : readText(el);
    if ((!input && !RTL_RE.test(text)) || (input && !text.trim())) return clearDirection(el);
    if (!input && inGoogleOverview(el)) preserveListLayouts(el);
    setDirection(el, 'data-vzx-d', RTL_RE.test(text) ? 'rtl' : 'ltr');
    directed.add(el);
    setAlignment(el);
  }

  function clearFont(el) {
    el.removeAttribute('data-vzx-f');
    el.removeAttribute('data-vzx-size');
    restoreProperty(el, '--vzx-fb');
    restoreProperty(el, '--vzx-size');
    restoreProperty(el, 'font-family');
    fonts.delete(el);
  }

  function baseFont(el) {
    const computed = getComputedStyle(el);
    return (computed.fontFamily.includes('Vzx') ? computed.getPropertyValue('--vzx-fb') : computed.fontFamily) || 'system-ui,sans-serif';
  }

  function fontFamilyCss() {
    return '"VzxFa",' + (vzxFontChoices(settings).english === 'site' ? '' : '"VzxAll",') +
      'var(--vzx-fb,system-ui,sans-serif)';
  }

  function updateFont(el, input = false) {
    if (el.closest(SKIP)) return clearFont(el);
    // Keep the same safe prose block as the font anchor when streamed Markdown
    // wraps direct text in spans/strong/em. Code and controls are excluded by readText.
    const text = input && 'value' in el ? el.value : readText(el);
    const hasText = RTL_RE.test(text) || (typeof settings.englishFont === 'string' &&
      vzxFontChoices(settings).english !== 'site' && /[A-Za-z]/.test(text));
    const display = getComputedStyle(el).display;
    // Google mixes direct answer/snippet text and inline controls in one block.
    // That is unsafe to reverse as a layout, but its own text can still receive
    // the font while the existing protected-font logic preserves its controls.
    const googleProse = GOOGLE_SEARCH && !!el.closest(GOOGLE_CONTENT) &&
      TEXT_TAGS.test(el.tagName) && !isLayout(display);
    if (!hasText || el === document.body || el === document.documentElement ||
        (!input && !['inline', 'contents'].includes(display) && findTextBlock(el) !== el &&
          !(el.tagName === 'LI' && isMessageProseList(el.parentElement)) && !googleProse) ||
        (input && !('value' in el) && (isLayout(display) || hasLayoutInside(el)))) return clearFont(el);
    // Keep inherited code, math, and icon fonts, including content added while streaming.
    el.querySelectorAll(PROTECTED + ', ' + CONTROLS + ', [data-vzx-layout-direction], [aria-hidden="true"], [contenteditable="false"], .monaco-editor, .cm-editor, .CodeMirror').forEach((child) => {
      if (protectedFonts.has(child)) return;
      setProperty(child, '--vzx-protected-font', baseFont(child));
      setAttribute(child, 'data-vzx-protected-font', '');
      protectedFonts.add(child);
    });
    if (!fonts.has(el)) {
      setProperty(el, '--vzx-fb', baseFont(el));
      setAttribute(el, 'data-vzx-f', '');
      fonts.add(el);
    }
    // Explicit inline/important site fonts can outrank our stylesheet. Override
    // only those text anchors, and retain their original value for full cleanup.
    const computed = getComputedStyle(el).fontFamily;
    if (savedProperties.get(el)?.has('font-family') || !computed.includes('VzxFa') ||
        (vzxFontChoices(settings).english !== 'site' && !computed.includes('VzxAll'))) {
      setProperty(el, 'font-family', fontFamilyCss(), 'important');
    }
  }

  function updateSizes(targets) {
    const scale = vzxFontScale(HOST, settings);
    if (scale === 100) {
      for (const el of targets) {
        el.removeAttribute('data-vzx-size');
        restoreProperty(el, '--vzx-size');
      }
      return;
    }
    // Measure with only our size overrides suspended. Font-size transitions
    // otherwise return their old/interpolated scaled value (Antigravity uses
    // transition:all on its editor), multiplying the scale again on every input.
    // Keep transitions suspended through the final size commit so restoring the
    // rule cannot restart a native-to-scaled animation on every keystroke.
    const root = document.documentElement;
    const previous = root.getAttribute('data-vzx-measure-size');
    const previousTransition = root.getAttribute('data-vzx-size-transition');
    const sizes = new Map();
    root.setAttribute('data-vzx-size-transition', '');
    root.setAttribute('data-vzx-measure-size', '');
    try {
      for (const el of targets) if (fonts.has(el) && el.isConnected) {
        const size = parseFloat(getComputedStyle(el).fontSize);
        if (Number.isFinite(size)) sizes.set(el, `${Math.round(size * scale / 100 * 10000) / 10000}px`);
      }
      if (previous === null) root.removeAttribute('data-vzx-measure-size');
      else root.setAttribute('data-vzx-measure-size', previous);
      for (const [el, size] of sizes) {
        setProperty(el, '--vzx-size', size);
        setAttribute(el, 'data-vzx-size', '');
      }
      // The measurement flag also suspended untouched anchors. Commit all of
      // them while transitions are disabled, including inherited nested sizes.
      for (const el of fonts) if (el.isConnected) void getComputedStyle(el).fontSize;
    } finally {
      if (previous === null) root.removeAttribute('data-vzx-measure-size');
      else root.setAttribute('data-vzx-measure-size', previous);
      if (previousTransition === null) root.removeAttribute('data-vzx-size-transition');
      else root.setAttribute('data-vzx-size-transition', previousTransition);
    }
  }

  function clearList(list) {
    for (const el of listLayouts.get(list) || []) releaseLayout(list, el);
    listLayouts.delete(list);
    list.removeAttribute('data-vzx-list');
    restoreProperty(list, '--vzx-list-start');
    restoreProperty(list, '--vzx-list-end');
    restoreProperty(list, 'direction');
    restoreProperty(list, 'margin-inline-start');
    restoreProperty(list, 'margin-inline-end');
    lists.delete(list);
    listMetrics.delete(list);
  }

  function updateList(list) {
    const items = getTextListItems(list);
    const texts = items.map((item) => readText(item, true));
    const persian = texts.some((text) => RTL_RE.test(text));
    let inPersianList = false;
    for (let parent = list.parentElement?.closest('ul, ol'); parent; parent = parent.parentElement?.closest('ul, ol')) {
      if (RTL_RE.test(readText(parent, true))) { inPersianList = true; break; }
    }
    const messageList = isMessageProseList(list) || inGoogleOverview(list);
    const safe = isTextList(list) && (messageList || !hasLayoutInside(list));
    if (!safe || (!persian && !inPersianList)) return clearList(list);
    if (messageList) preserveListLayouts(list);
    if (!lists.has(list)) {
      const computed = getComputedStyle(list);
      const left = parseFloat(computed.paddingLeft) || 0;
      const right = parseFloat(computed.paddingRight) || 0;
      const markerSpace = computed.listStylePosition === 'outside' && computed.listStyleType !== 'none' ? 24 : 0;
      listMetrics.set(list, { start: Math.max(left, right, markerSpace), end: Math.min(left, right) });
      lists.add(list);
    }
    setDirection(list, 'data-vzx-list', persian ? 'rtl' : 'ltr');
    // Gemini's response container spans the page, but prose and lists have a narrower
    // max-width. Zero inline margins (including those set by another RTL extension)
    // anchor an RTL list to the viewport edge instead of the centered prose column.
    // Keep the site's own width and vertical spacing; only center top-level text lists.
    if (HOST === 'gemini.google.com' && persian &&
        list.parentElement?.matches('.markdown-main-panel, [id^="model-response-message-content"]')) {
      setProperty(list, 'margin-inline-start', 'auto', 'important');
      setProperty(list, 'margin-inline-end', 'auto', 'important');
    } else {
      restoreProperty(list, 'margin-inline-start');
      restoreProperty(list, 'margin-inline-end');
    }
    // Mixed lists need room for English markers on the left and Persian markers on the right.
    const mixed = persian && texts.some((text) => text.trim() && !RTL_RE.test(text));
    const metrics = listMetrics.get(list);
    setProperty(list, '--vzx-list-start', `${metrics.start}px`);
    setProperty(list, '--vzx-list-end', `${mixed ? metrics.start : metrics.end}px`);
    items.forEach((item, index) => {
      setDirection(item, 'data-vzx-item', RTL_RE.test(texts[index]) ? 'rtl' : 'ltr');
      listItems.add(item);
      setAlignment(item);
    });
  }

  function releaseUnused() {
    for (const el of directed) if (!el.isConnected) clearDirection(el);
    for (const el of fonts) if (!el.isConnected) clearFont(el);
    for (const el of lists) if (!el.isConnected) clearList(el);
    for (const el of listItems) {
      if (!el.isConnected || !lists.has(el.parentElement?.closest('ul, ol'))) {
        el.removeAttribute('data-vzx-item');
        if (!directed.has(el)) {
          el.removeAttribute('data-vzx-align');
          restoreProperty(el, 'text-align');
          restoreProperty(el, 'direction');
        }
        listItems.delete(el);
      }
    }
    for (const el of protectedFonts) {
      if (!el.isConnected || !el.parentElement?.closest('[data-vzx-f]')) {
        el.removeAttribute('data-vzx-protected-font');
        restoreProperty(el, '--vzx-protected-font');
        protectedFonts.delete(el);
      }
    }
  }

  function scan(root, blocks, fontTargets, inputs, listTargets) {
    if (root.nodeType === Node.TEXT_NODE) root = root.parentElement;
    if (!(root instanceof Element)) return;
    // A mutation can remove the last Persian letter from a nested span, or
    // turn a previously managed subtree into code/a layout. Revalidate existing
    // anchors even when the changed node no longer contains collectable prose.
    const collectManaged = (el) => {
      if (directed.has(el)) blocks.add(el);
      if (fonts.has(el)) fontTargets.add(el);
      if (lists.has(el)) listTargets.add(el);
    };
    for (let el = root; el; el = el.parentElement) collectManaged(el);
    root.querySelectorAll('[data-vzx-d], [data-vzx-f], [data-vzx-list]').forEach(collectManaged);
    if (GOOGLE_SEARCH && !root.closest(GOOGLE_CONTENT)) {
      root.querySelectorAll(GOOGLE_CONTENT).forEach(scope => scan(scope, blocks, fontTargets, inputs, listTargets));
      return;
    }
    if (root.closest(SKIP)) return;
    const input = root.closest(INPUTS);
    if (input) { inputs.add(input); return; }
    for (let list = root.closest('ul, ol'); list; list = list.parentElement?.closest('ul, ol')) listTargets.add(list);
    root.querySelectorAll('ul, ol').forEach((list) => listTargets.add(list));
    const collect = (el) => {
      fontTargets.add(el);
      const block = findTextBlock(el);
      if (block) { blocks.add(block); fontTargets.add(block); }
    };
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
        if (node.matches(SKIP)) return NodeFilter.FILTER_REJECT;
        if (node.matches(INPUTS)) { inputs.add(node); return NodeFilter.FILTER_REJECT; }
        return NodeFilter.FILTER_SKIP;
      }
    });
    let node;
    while ((node = walker.nextNode())) if (node.nodeValue.trim()) collect(node.parentElement);
  }

  function flush() {
    const roots = Array.from(pending).filter((node) => node.isConnected);
    pending.clear();
    const blocks = new Set(), fontTargets = new Set(), inputs = new Set(), listTargets = new Set();
    for (const root of roots) {
      if (!roots.some((other) => other !== root && other.contains(root))) scan(root, blocks, fontTargets, inputs, listTargets);
    }
    listTargets.forEach(list => {
      updateList(list);
      if (lists.has(list) && isMessageProseList(list)) {
        for (const item of list.children) fontTargets.add(item);
      }
    });
    fontTargets.forEach((el) => updateFont(el));
    blocks.forEach((el) => {
      if (findTextBlock(el) === el) updateDirection(el);
      else clearDirection(el);
    });
    inputs.forEach((el) => { updateFont(el, true); updateDirection(el, true); });
    updateSizes(new Set([...fontTargets, ...inputs]));
    releaseUnused();
  }

  function schedule(node) {
    if (!running || !node) return;
    pending.add(node);
    if (scheduled) return;
    scheduled = true;
    const current = generation;
    // MutationObserver runs before painting. A fixed timeout let replacement
    // response nodes paint in the website font for one or more frames.
    queueMicrotask(() => {
      if (current !== generation) return;
      scheduled = false;
      if (running) flush();
    });
  }

  function onInput(event) {
    if (event.target instanceof Element && event.target.closest(INPUTS)) schedule(event.target);
  }

  function onResize() { schedule(document.body); }

  function start() {
    if (running) return;
    running = true;
    applyStyle();
    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) schedule(mutation.target);
    });
    observer.observe(document.body || document.documentElement, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ['class', 'dir', 'contenteditable']
    });
    document.addEventListener('input', onInput, true);
    document.addEventListener('focusin', onInput, true);
    window.addEventListener('resize', onResize);
    schedule(document.body || document.documentElement);
  }

  function stop() {
    if (!running) return;
    running = false;
    observer?.disconnect();
    observer = null;
    generation++;
    scheduled = false;
    pending.clear();
    document.removeEventListener('input', onInput, true);
    document.removeEventListener('focusin', onInput, true);
    window.removeEventListener('resize', onResize);
    for (const el of directed) clearDirection(el);
    for (const el of fonts) clearFont(el);
    for (const el of lists) clearList(el);
    releaseUnused();
    document.getElementById(STYLE_ID)?.remove();
  }

  function evaluate() {
    if (!shouldRun()) stop();
    else if (running) { applyStyle(); schedule(document.body || document.documentElement); }
    else start();
  }

  chrome.storage.sync.get(VZX_DEFAULT_SETTINGS, (stored) => {
    settings = { ...VZX_DEFAULT_SETTINGS, ...stored };
    evaluate();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const key of Object.keys(changes)) settings[key] = changes[key].newValue ?? VZX_DEFAULT_SETTINGS[key];
    evaluate();
  });
  chrome.runtime.onMessage?.addListener((message, _sender, respond) => {
    if (message?.type !== 'vzx-font-scale-preview' || vzxSiteHost(message.host) !== HOST ||
        typeof message.value !== 'number' || !Number.isFinite(message.value)) return;
    settings = { ...settings, fontSizes: { ...settings.fontSizes,
      [HOST]: Math.max(60, Math.min(200, message.value)) } };
    evaluate();
    respond?.({ ok: true });
  });
})();
