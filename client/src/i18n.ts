import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { STORAGE_PREFIX } from './config';

const STORAGE_KEY = STORAGE_PREFIX + 'lang';

// 自动发现 locales/ 目录下的所有翻译文件
const localeModules = import.meta.glob('./locales/*.json', {
    eager: true,
    import: 'default'
}) as Record<string, Record<string, unknown>>;

interface LangInfo {
    code: string;
    label: string;
}

// 从文件名和翻译内容自动生成语言配置
const allTranslations: Record<string, Record<string, unknown>> = {};
const langList: LangInfo[] = [];

for (const [path, translations] of Object.entries(localeModules)) {
    const code = path.replace('./locales/', '').replace('.json', '');
    allTranslations[code] = translations as Record<string, unknown>;
    const label = ((translations as Record<string, unknown>)?.language as Record<string, unknown> | undefined)?.label as string | undefined;
    langList.push({ code, label: label || code });
}

// 按 code 排序，让语言列表稳定
langList.sort((a, b) => a.code.localeCompare(b.code));

export const LANGUAGES: readonly LangInfo[] = langList;
export const DEFAULT_LANG = langList[0]?.code || 'zh-CN';
export const SUPPORTED_LANGS: readonly string[] = langList.map((l) => l.code);

function mapBrowserLang(browserLang: string): string {
    const lang = browserLang.toLowerCase();
    // 精确匹配
    for (const supported of SUPPORTED_LANGS) {
        if (supported.toLowerCase() === lang) return supported;
    }
    // 前缀匹配（如 zh → zh-CN）
    const prefix = lang.split('-')[0];
    for (const supported of SUPPORTED_LANGS) {
        if (supported.startsWith(prefix)) return supported;
    }
    return DEFAULT_LANG;
}

function getSavedLang(): string {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored && SUPPORTED_LANGS.includes(stored)) return stored;
    } catch {
        /* ignore */
    }
    if (typeof navigator !== 'undefined' && navigator.language) {
        return mapBrowserLang(navigator.language);
    }
    return DEFAULT_LANG;
}

// 构建 i18next resources
const resources: Record<string, { translation: Record<string, unknown> }> = {};
for (const [code, translations] of Object.entries(allTranslations)) {
    resources[code] = { translation: translations };
}

i18n.use(initReactI18next).init({
    resources,
    lng: getSavedLang(),
    fallbackLng: DEFAULT_LANG,
    interpolation: {
        escapeValue: false,
        prefix: '{',
        suffix: '}'
    }
});

export function changeLanguage(lang: string) {
    try {
        localStorage.setItem(STORAGE_KEY, lang);
    } catch {
        /* ignore */
    }
    i18n.changeLanguage(lang);
}

export default i18n;
