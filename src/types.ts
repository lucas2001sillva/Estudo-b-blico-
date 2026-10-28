export interface Verse { number: number; text: string }
export interface Book { id: string; name: string; abbreviation: string; testament: 'AT' | 'NT'; chapterCount: number }
export interface Chapter { number: number; verses: Verse[]; sourcePages: number[] }
export interface Source { id: string; title: string; file: string; totalPages: number }
export interface StudyVisual {
  id: string;
  title: string;
  lightSrc: string;
  darkSrc?: string;
  width: number;
  height: number;
  description: string;
  accessibleText?: string;
  kind: 'chart' | 'table' | 'diagram' | 'illustration' | 'page';
  redrawn: boolean;
}
export type StudyBlock = { kind: 'text'; text: string } | { kind: 'visual'; visualId: string };
export interface StudySection {
  title: string;
  body: string;
  sourcePage: number;
  reviewStatus: 'extracted' | 'ocr-extracted' | 'ocr-reviewed' | 'needs-review';
  displayBody?: string;
  bodyAfterVisuals?: string;
  /** Unverified extraction, available for consultation but excluded from narration. */
  sourceTranscript?: string;
  /** Complete verified reading, including figure descriptions; an empty value suppresses narration. */
  readingText?: string;
  visuals?: StudyVisual[];
  /** Prose and figure references in their source reading order. */
  blocks?: StudyBlock[];
}
export interface Lesson { id: string; title: string; trailId: string; description: string; summary?: string; summarySourcePages?: number[]; sourceId: string; startPage: number; endPage: number; sections: StudySection[] }
export interface Trail { id: string; title: string; description: string; lessonIds: string[]; recommended: boolean }
export interface Question { id: string; prompt: string; choices: string[]; answerIndex: number; explanation: string; source: { sourceId: string; page: number } }
export interface Quiz { id: string; lessonId: string; title: string; questions: Question[] }
export interface Studies { sources: Source[]; trails: Trail[]; lessons: Lesson[]; quizzes: Quiz[] }
export interface Passage { id: string; bookId: string; bookName: string; chapter: number; verseStart: number; verseEnd: number; text: string }
export interface Catalog { version: string; books: Book[]; studies: Studies; passages: Passage[] }
export interface QuizAttempt { id: string; quizId: string; score: number; total: number; createdAt: string; answers?: number[] }
export interface Preferences { theme: 'light' | 'dark'; fontSize: number; speechRate: number }
export interface ReadingPosition { bookId: string; chapter: number; verse?: number }
export interface ProgressState {
  completedChapters: Record<string, boolean>;
  completedLessons: Record<string, boolean>;
  quizAttempts: QuizAttempt[];
  preferences: Preferences;
  selectedTrailId: string | null;
  lastReading: ReadingPosition | null;
}
export interface StatePatch {
  completedChapters?: Record<string, boolean>;
  completedLessons?: Record<string, boolean>;
  quizAttempts?: QuizAttempt[];
  preferences?: Partial<Preferences>;
  selectedTrailId?: string | null;
  lastReading?: ReadingPosition | null;
}
export interface User { id: string; name: string; email: string }
export type Page = 'home' | 'bible' | 'studies' | 'quiz' | 'progress';
