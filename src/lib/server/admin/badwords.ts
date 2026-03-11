import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const CONFIG_PATH = resolve('src/lib/server/admin/badwords.json');

export interface BadWordsConfig {
    enabled: boolean;
    words: string[];
}

export function getBadWordsConfig(): BadWordsConfig {
    try {
        const raw = readFileSync(CONFIG_PATH, 'utf-8');
        return JSON.parse(raw) as BadWordsConfig;
    } catch {
        return { enabled: false, words: [] };
    }
}

export function saveBadWordsConfig(config: BadWordsConfig): void {
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 4) + '\n', 'utf-8');
}

export function checkForBadWords(content: string): string[] {
    const config = getBadWordsConfig();
    if (!config.enabled || config.words.length === 0) return [];
    const lower = content.toLowerCase();
    return config.words.filter(word => {
        const pattern = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        return pattern.test(lower);
    });
}
