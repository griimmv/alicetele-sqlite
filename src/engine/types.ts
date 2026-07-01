export interface WikiResult {
  title: string;
  url: string;
  extract: string;
  fullContent?: string;
  thumbnail?: string;
  notification?: string;
  foundArticle: boolean;
}

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}
