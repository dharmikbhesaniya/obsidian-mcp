/**
 * In-memory BM25 (Best Matching 25) relevance engine for Obsidian vaults.
 * Provides lexical ranking with document length normalization and title weighting
 * without external database or native C++ dependencies.
 */

export interface DocumentItem {
  id: string; // Relative note path
  title: string; // Note base name
  content: string; // Note text content
}

export interface BM25Result {
  path: string;
  score: number;
  lines: number[];
}

export class BM25Engine {
  private readonly k1: number;
  private readonly b: number;
  private docs: DocumentItem[] = [];
  private docLengths: number[] = [];
  private avgdl: number = 0;
  private df: Map<string, number> = new Map();
  private docTermFreqs: Array<Map<string, number>> = [];

  constructor(docs: DocumentItem[] = [], k1: number = 1.2, b: number = 0.75) {
    this.k1 = k1;
    this.b = b;
    this.setDocuments(docs);
  }

  public setDocuments(docs: DocumentItem[]): void {
    this.docs = docs;
    this.buildIndex();
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1);
  }

  private buildIndex(): void {
    let totalLength = 0;
    this.docLengths = [];
    this.docTermFreqs = [];
    this.df.clear();

    for (const doc of this.docs) {
      const bodyTokens = this.tokenize(doc.content);
      const titleTokens = this.tokenize(doc.title);
      // Give 2x weight to title/filename tokens
      const combinedTokens = [...titleTokens, ...titleTokens, ...bodyTokens];

      const len = combinedTokens.length;
      this.docLengths.push(len);
      totalLength += len;

      const tf = new Map<string, number>();
      for (const t of combinedTokens) {
        tf.set(t, (tf.get(t) || 0) + 1);
      }
      this.docTermFreqs.push(tf);

      for (const term of tf.keys()) {
        this.df.set(term, (this.df.get(term) || 0) + 1);
      }
    }

    this.avgdl = this.docs.length > 0 ? totalLength / this.docs.length : 0;
  }

  public search(query: string, limit: number = 50): BM25Result[] {
    const queryTokens = this.tokenize(query);
    if (queryTokens.length === 0 || this.docs.length === 0) {
      return [];
    }

    const N = this.docs.length;
    const scoredDocs: Array<{ docIndex: number; score: number }> = [];

    for (let i = 0; i < N; i++) {
      const tfMap = this.docTermFreqs[i];
      const docLen = this.docLengths[i];
      let score = 0;

      for (const q of queryTokens) {
        const tf = tfMap.get(q) || 0;
        if (tf === 0) continue;

        const df = this.df.get(q) || 0;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        const num = tf * (this.k1 + 1);
        const denom = tf + this.k1 * (1 - this.b + this.b * (docLen / (this.avgdl || 1)));
        score += idf * (num / denom);
      }

      if (score > 0) {
        scoredDocs.push({
          docIndex: i,
          score: Math.round(score * 1000) / 1000,
        });
      }
    }

    scoredDocs.sort((a, b) => b.score - a.score);
    const topScored = scoredDocs.slice(0, limit);

    // Compute line matches for the top scored documents
    const queryLower = query.toLowerCase();
    const queryWords = queryTokens;

    return topScored.map(({ docIndex, score }) => {
      const doc = this.docs[docIndex];
      const lines = doc.content.split("\n");
      const matchedLines: number[] = [];

      lines.forEach((lineText, idx) => {
        const lowerLine = lineText.toLowerCase();
        if (
          lowerLine.includes(queryLower) ||
          queryWords.some((w) => lowerLine.includes(w))
        ) {
          matchedLines.push(idx + 1);
        }
      });

      return {
        path: doc.id,
        score,
        lines: matchedLines.slice(0, 10),
      };
    });
  }
}
