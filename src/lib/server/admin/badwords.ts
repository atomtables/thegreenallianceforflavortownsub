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

/**
 * Check message content against bad words list.
 * Each word entry is treated as a regex pattern.
 * Default entries use word-boundary patterns like `\bword\b`.
 * Admins can add custom regex patterns for more advanced matching.
 */
export function checkForBadWords(content: string): string[] {
    const config = getBadWordsConfig();
    if (!config.enabled || config.words.length === 0) return [];
    const lower = content.toLowerCase();
    return config.words.filter(word => {
        try {
            // Validate that the regex isn't excessively complex (basic ReDoS protection)
            if (word.length > 200) return false;
            const pattern = new RegExp(word, 'i');
            return pattern.test(lower);
        } catch {
            // If the pattern is invalid regex, fall back to escaped literal match
            const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const fallback = new RegExp(`\\b${escaped}\\b`, 'i');
            return fallback.test(lower);
        }
    });
}
