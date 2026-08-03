const DEFAULT_WORDS = ['操', 'fuck', 'shit', 'sb', '傻逼', '草泥马', '垃圾'];

export class SensitiveWordFilter {
  private words: Set<string>;

  constructor(customWords: string[] = []) {
    this.words = new Set([...DEFAULT_WORDS, ...customWords]);
  }

  filter(text: string): string {
    let result = text;
    for (const word of this.words) {
      const replacement = '*'.repeat(word.length);
      result = result.replace(new RegExp(word, 'gi'), replacement);
    }
    return result;
  }

  hasSensitiveWord(text: string): boolean {
    const lower = text.toLowerCase();
    for (const word of this.words) {
      if (lower.includes(word.toLowerCase())) {
        return true;
      }
    }
    return false;
  }

  addWords(words: string[]): void {
    for (const word of words) {
      this.words.add(word);
    }
  }
}
