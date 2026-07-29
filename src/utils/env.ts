import { access, constants } from "node:fs/promises";

declare global {
    interface String {
        isEmpty(): boolean;
    }
    interface Array<T> {
        /** 数组去重。无参数时按值去重，传 prop 时按对象属性去重 */
        unique(prop?: keyof T): T[];
        /** 并集：A ∪ B */
        union(that: T[], prop?: keyof T): T[];
        /** 交集：A ∩ B */
        intersect(that: T[], prop?: keyof T): T[];
        /** 差集：A \\ B（A 中有而 B 中没有的） */
        difference(that: T[], prop?: keyof T): T[];
        /** 相对补集：B \\ A（B 中有而 A 中没有的） */
        complement(that: T[], prop?: keyof T): T[];
        /** 对称差集：A △ B（两边不同时有的元素） */
        symmetricDifference(that: T[], prop?: keyof T): T[];
        /** 子集判断：A ⊆ B */
        isSubsetOf(that: T[], prop?: keyof T): boolean;
        /** 超集判断：A ⊇ B */
        isSupersetOf(that: T[], prop?: keyof T): boolean;
        /** 真子集：A ⊂ B（A ⊆ B 且 A ≠ B） */
        isProperSubsetOf(that: T[], prop?: keyof T): boolean;
        /** 真超集：A ⊃ B（A ⊇ B 且 A ≠ B） */
        isProperSupersetOf(that: T[], prop?: keyof T): boolean;
        /** 笛卡尔积：A × B（所有有序对） */
        cartesianProduct<U>(that: U[]): [T, U][];
    }
}
String.prototype.isEmpty = function (this: String): boolean {
    return this.length === 0;
}
Array.prototype.unique = function <T>(this: T[], prop?: keyof T): T[] {
    if (isNullOrUndefined(prop)) {
        const seen = new Set<T>();
        return this.filter(item => {
            if (seen.has(item)) return false;
            seen.add(item);
            return true;
        });
    } else {
        const seen = new Map<unknown, boolean>();
        const nanSymbol = Symbol();
        return this.filter(item => {
            const rawKey = item[prop];
            const key = isNumber(rawKey) && Number.isNaN(rawKey) ? nanSymbol : rawKey;
            if (seen.has(key)) return false;
            seen.set(key, true);
            return true;
        });
    }
};
Array.prototype.union = function <T>(this: T[], that: T[], prop?: keyof T): T[] {
    return [...this, ...that].unique(prop)
}
Array.prototype.intersect = function <T>(this: T[], that: T[], prop?: keyof T): T[] {
    return this.filter((item) =>
        that.some((t) => isNullOrUndefined(prop) ? t === item : t[prop] === item[prop])
    ).unique(prop)
}
Array.prototype.difference = function <T>(this: T[], that: T[], prop?: keyof T): T[] {
    return this.filter((item) =>
        !that.some((t) => isNullOrUndefined(prop) ? t === item : t[prop] === item[prop])
    ).unique(prop)
}
Array.prototype.complement = function <T>(this: T[], that: T[], prop?: keyof T): T[] {
    return that.difference(this, prop)
}
Array.prototype.symmetricDifference = function <T>(this: T[], that: T[], prop?: keyof T): T[] {
    return this.union(that, prop).difference(this.intersect(that, prop), prop)
}
Array.prototype.isSubsetOf = function <T>(this: T[], that: T[], prop?: keyof T): boolean {
    return this.every((item) =>
        that.some((t) => isNullOrUndefined(prop) ? t === item : t[prop as keyof T] === item[prop as keyof T])
    )
}
Array.prototype.isSupersetOf = function <T>(this: T[], that: T[], prop?: keyof T): boolean {
    return that.isSubsetOf(this, prop)
}
Array.prototype.isProperSubsetOf = function <T>(this: T[], that: T[], prop?: keyof T): boolean {
    return this.length < that.length && this.isSubsetOf(that, prop)
}
Array.prototype.isProperSupersetOf = function <T>(this: T[], that: T[], prop?: keyof T): boolean {
    return this.length > that.length && this.isSupersetOf(that, prop)
}
Array.prototype.cartesianProduct = function <T, U>(this: T[], that: U[]): [T, U][] {
    return this.flatMap((a) => that.map((b) => [a, b] as [T, U]))
}

type Falsy = null | undefined | void | '' | never;
type PrunedArray<T> = T extends never ? [] : Array<Pruned<T>>;
type PrunedObject<T> = {
    [K in keyof T as Pruned<T[K]> extends Falsy ? never : K]: Pruned<T[K]>;
};
export type Pruned<T> =
    T extends null | undefined | void ? never :         // null/undefined → 消失
    T extends '' ? never :                               // 空字符串 → 消失
    T extends readonly [] ? never :                      // 空数组 → 消失
    T extends Array<infer U> ? PrunedArray<U> :          // 非空数组 → 递归清理元素
    T extends object ? PrunedObject<T> :                 // 非空对象 → 递归清理属性
    T;                                                    // 其他原样保留
export const isNull = (obj: unknown): obj is null => obj === null;
export const isUndefined = (obj: unknown): obj is undefined => typeof obj === 'undefined';
export const isNullOrUndefined = (obj: unknown): obj is null | undefined => isUndefined(obj) || isNull(obj);
export const isObject = (obj: unknown): obj is Object => !isNullOrUndefined(obj) && typeof obj === 'object' && !Array.isArray(obj)
export const isString = (obj: unknown): obj is string => !isNullOrUndefined(obj) && typeof obj === 'string';
export const isNumber = (obj: unknown): obj is number => !isNullOrUndefined(obj) && typeof obj === 'number';
export const isArray = (obj: unknown): obj is Array<any> => Array.isArray(obj)
export const isNotEmpty = (obj: unknown): boolean => {
    if (isNullOrUndefined(obj)) {
        return false
    }
    if (Array.isArray(obj)) {
        return obj.some(isNotEmpty);
    }
    if (isString(obj)) {
        return !obj.isEmpty();
    }
    if (isNumber(obj)) {
        return !Number.isNaN(obj)
    }
    if (isObject(obj)) {
        return Object.values(obj).some(isNotEmpty)
    }
    return true
}
export function prune<T>(data: T): Pruned<T> {
    if (Array.isArray(data)) {
        return data.map(item => prune(item)).filter(isNotEmpty) as Pruned<T>;
    }
    if (isObject(data)) {
        const result = Object.fromEntries(
            Object.entries(data)
                .filter(([, v]) => isNotEmpty(v))
                .map(([k, v]) => [k, prune(v)])
                .filter(([, v]) => isNotEmpty(v))
        );
        return result as Pruned<T>;
    }
    return data as Pruned<T>;
}
/** Type guard that always returns true — for use with pick() when any non-undefined value is acceptable */
export const isPresent = <T = unknown>(_v: unknown): _v is T => true;

/** Safely convert to number, returning null for nullish values */
export const toNumberOrNull = (v: unknown): number | null =>
    isNullOrUndefined(v) ? null : Number(v);

/** Safely convert to string, returning null for non-string values */
export const toStringOrNull = (v: unknown): string | null =>
    isString(v) ? v : null;

/**
 * 创建一个 pick 辅助函数，用于从请求 body 中安全提取字段值。
 * 仅当值 !== undefined 且通过 check 校验后，才写入 updates 对象。
 * @param body - 请求体对象
 * @param updates - 待写入的目标对象
 * @returns pick(key, check, map?) 函数
 */
export function createPicker(
    body: Record<string, unknown>,
    updates: Record<string, unknown>,
) {
    return <T>(key: string, check: (v: unknown) => v is T, map?: (v: T) => unknown) => {
        const v = body[key];
        if (v !== undefined && check(v)) {
            updates[key] = map ? map(v) : v;
        }
    };
}

export async function checkFileExists(filePath: string) {
    try {
        await access(filePath, constants.F_OK);
        return true; // 文件存在
    } catch {
        return false; // 文件不存在
    }
}
