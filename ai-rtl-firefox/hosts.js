// لیست پیش‌فرض سایت‌های هوش مصنوعی. (از طریق پاپ‌آپ می‌توانید هر سایت دیگری را هم اضافه کنید.)
const VZX_DEFAULT_HOSTS = [
  // OpenAI / Anthropic / Google / Microsoft / xAI / Meta
  'chatgpt.com', 'chat.openai.com', 'platform.openai.com', 'sora.com',
  'claude.ai', 'console.anthropic.com',
  'gemini.google.com', 'antigravity.google.com', 'aistudio.google.com', 'notebooklm.google.com', 'notebook.google.com', 'labs.google',
  'copilot.microsoft.com',
  'grok.com',
  'meta.ai',
  // جستجوگرها و دستیارها
  'perplexity.ai', 'you.com', 'phind.com', 'duck.ai', 'felo.ai', 'genspark.ai', 'manus.im',
  // مدل‌های چینی و اروپایی
  'chat.deepseek.com', 'deepseek.com', 'chat.qwen.ai', 'qwen.ai', 'kimi.com', 'kimi.moonshot.cn',
  'chat.z.ai', 'z.ai', 'chat.mistral.ai', 'doubao.com', 'yuanbao.tencent.com', 'ernie.baidu.com',
  // پلتفرم‌ها و بازارچه‌ها
  'poe.com', 'huggingface.co', 'openrouter.ai', 'lmarena.ai', 'arena.ai', 't3.chat', 'character.ai', 'pi.ai',
  'blackbox.ai', 'monica.im', 'chatbot.app', 'typingmind.com', 'librechat.ai', 'cohere.com',
  // سایت‌های فارسی
  'gapgpt.app', 'talkbot.ir'
];

function vzxNormalizeHost(host) {
  return typeof host === 'string' ? host.trim().toLowerCase().replace(/^www\./, '') : '';
}

// Antigravity renders its remote chat in a cross-origin iframe. Treat that
// specific official document as the same site for toggles and font-size storage.
function vzxSiteHost(host) {
  host = vzxNormalizeHost(host);
  return host === 'antigravity.static.usercontent.goog' ? 'antigravity.google.com' : host;
}

function vzxMatch(host, list) {
  host = vzxNormalizeHost(host);
  return !!host && Array.isArray(list) && list.some((value) => {
    const h = vzxNormalizeHost(value);
    return !!h && (host === h || host.endsWith('.' + h));
  });
}

// Search is supported without enabling the extension on unrelated Google apps.
function vzxIsGoogleSearch(host, pathname) {
  return vzxNormalizeHost(host) === 'google.com' && pathname === '/search';
}

function vzxIsDefaultSite(host, pathname) {
  return vzxMatch(host, VZX_DEFAULT_HOSTS) || vzxIsGoogleSearch(host, pathname);
}

// Font sizes belong to this exact site, not its parent domain or sibling sites.
function vzxFontScale(host, settings) {
  const sizes = settings && settings.fontSizes;
  const key = vzxSiteHost(host);
  if (!key || !sizes || typeof sizes !== 'object' || Array.isArray(sizes) ||
      !Object.prototype.hasOwnProperty.call(sizes, key)) return 100;
  const value = sizes[key];
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(200, Math.max(60, value)) : 100;
}

const VZX_DEFAULT_SETTINGS = {
  enabled: true,        // کلید کلی افزونه
  allSites: false,      // اعمال روی همه سایت‌ها (فقط روی متن فارسی اثر می‌گذارد)
  latinToo: false,      // وزیر روی متن لاتین هم اعمال شود
  customHosts: [],      // سایت‌هایی که کاربر اضافه کرده
  disabledHosts: [],    // سایت‌هایی که کاربر غیرفعال کرده
  fontSizes: {},       // درصد اندازهٔ متن، جداگانه برای هر نام میزبان
  persianFont: 'vazirmatn',
  englishFont: null    // null migrates the older latinToo preference
};

function vzxFontChoices(settings = {}) {
  if (!settings || typeof settings !== 'object') settings = {};
  const persian = ['vazirmatn', 'tahoma', 'arial', 'segoe-ui', 'system'];
  const english = ['site', 'vazirmatn', 'arial', 'segoe-ui', 'georgia', 'times-new-roman'];
  return {
    persian: persian.includes(settings.persianFont) ? settings.persianFont : 'vazirmatn',
    english: settings.englishFont == null ? (settings.latinToo ? 'vazirmatn' : 'site') :
      (english.includes(settings.englishFont) ? settings.englishFont : 'site')
  };
}
