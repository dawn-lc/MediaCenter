/**
 * 领域实体多语言词典 —— 外部 JSON 数据文件 + 运行时热重载
 *
 * 词典数据存于 JSON 文件(默认 /config/entity-dict.json, 可用 ENTITY_DICT_PATH 覆盖)。
 * 支持 mtime 检测热重载: 直接编辑宿主机 JSON 文件即生效, 无需重新编译/重新部署。
 *
 * JSON 格式: [ { "id": "...", "names": ["中文", "English", "日本語", ...] }, ... ]
 * 匹配: 文本(大小写不敏感)包含任一 name 即命中 → 返回该实体其他 names 中未在文本出现的。
 * 用法: 加词条 → 编辑 /etc/MediaCenter/entity-dict.json (容器内 /config/entity-dict.json)
 */
import { readFileSync, statSync } from 'fs';

export interface EntityEntry {
    id: string;
    names: string[];
}

/** 词典文件路径: 优先 ENTITY_DICT_PATH, 默认容器挂载点 /config/entity-dict.json */
function dictPath(): string {
    return process.env.ENTITY_DICT_PATH || '/config/entity-dict.json';
}

let _entries: EntityEntry[] = [];
let _loadedMtime = 0;
let _nameToEntries = new Map<string, EntityEntry[]>();
let _dictRe: RegExp | null = null;

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rebuildIndex(entries: EntityEntry[]): void {
    const map = new Map<string, EntityEntry[]>();
    for (const entry of entries) {
        for (const name of entry.names) {
            const norm = name.toLowerCase();
            if (!map.has(norm)) map.set(norm, []);
            map.get(norm)!.push(entry);
        }
    }
    // 长名优先, 保证 alternation 匹配到最长别名
    const names = [...map.keys()].sort((a, b) => b.length - a.length);
    _nameToEntries = map;
    _dictRe = new RegExp(names.map(escapeRegExp).join('|'), 'gi');
}

/**
 * 按需加载/热重载词典: 文件 mtime 变化时重建索引。
 * 每次调用为一次本地 statSync, 开销可忽略; 搜索路径每次查询触发。
 */
export function ensureDictLoaded(): number {
    const p = dictPath();
    try {
        const st = statSync(p);
        if (st.mtimeMs === _loadedMtime && _dictRe) return _entries.length;
        const raw = JSON.parse(readFileSync(p, 'utf8')) as EntityEntry[] | { entities?: EntityEntry[] };
        const list = (Array.isArray(raw) ? raw : raw.entities ?? []).filter(
            (e): e is EntityEntry => !!e && Array.isArray(e.names)
        );
        _entries = list;
        rebuildIndex(list);
        _loadedMtime = st.mtimeMs;
        console.log(`[dict] 词典已加载/热更新: ${list.length} 条 (${p})`);
    } catch (e) {
        console.warn('[dict] 词典加载失败(使用空词典):', e instanceof Error ? e.message : e);
        _entries = [];
        _nameToEntries = new Map();
        _dictRe = null;
        _loadedMtime = 0;
    }
    return _entries.length;
}

/** 从文本匹配词典实体, 返回该实体其他语言别名(去重, 排除已在文本中的; 自动热重载) */
export function matchDictAliases(text: string): string[] {
    ensureDictLoaded();
    if (!_dictRe || _nameToEntries.size === 0) return [];
    const found = new Set<string>();
    const seen = new Set<string>();
    const lower = text.toLowerCase();
    for (const m of text.matchAll(_dictRe)) {
        const name = m[0].toLowerCase();
        for (const entry of _nameToEntries.get(name) ?? []) {
            if (seen.has(entry.id)) continue;
            seen.add(entry.id);
            for (const alias of entry.names) {
                if (!lower.includes(alias.toLowerCase())) found.add(alias);
            }
        }
    }
    return [...found];
}

/**
 * 从文本匹配词典实体, 返回命中的实体 id 列表(去重; 自动热重载)。
 * 用于实体级消歧: 如查询"甘雨"命中 ganyu 实体, 标题"宵宫 Yoimiya"命中 yoimiya 实体,
 * 可据此判断标题实体 ≠ 查询实体, 做软降权而非硬剔除。
 */
export function matchEntityIds(text: string): string[] {
    ensureDictLoaded();
    if (!_dictRe || _nameToEntries.size === 0) return [];
    const found = new Set<string>();
    for (const m of text.matchAll(_dictRe)) {
        const name = m[0].toLowerCase();
        for (const entry of _nameToEntries.get(name) ?? []) {
            found.add(entry.id);
        }
    }
    return [...found];
}
