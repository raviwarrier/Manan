
export enum NuggetType {
  QUOTE = 'quote',
  LEARNING = 'learning',
  INSIGHT = 'insight'
}

export interface BookNugget {
  id: string;
  type: NuggetType;
  content: string;
  source?: string;
  locationLabel?: string;
  sortIndex: number;
}

export interface ChapterData {
  title: string;
  nuggets: BookNugget[];
  isBackMatter: boolean;
  isFrontMatter: boolean;
}

export interface Book {
  title: string;
  author?: string;
  chapters: string[];
  chapterLocations: string[]; // Page numbers or Section markers
}

export interface NoteItem {
  id: string;
  content: string;
  type: NuggetType;
  chapterTitle: string;
  chapterIndex: number;
  sortIndex: number;
  locationLabel?: string;
}

export interface UsageStats {
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedCost: number;
}
